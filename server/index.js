const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs-extra');
const YAML = require('yaml');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 3001;
const WS_PORT = 8081; // 改为8081避免端口冲突

app.use(cors());
app.use(express.json());

// WebSocket服务器用于实时更新
const wss = new WebSocket.Server({ port: WS_PORT });

// 广播消息给所有连接的客户端
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// 执行kubectl命令的辅助函数
function executeKubectl(command) {
  return new Promise((resolve, reject) => {
    exec(`kubectl ${command}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`kubectl error: ${error.message}`);
        reject({ error: error.message, stderr });
      } else {
        resolve(stdout);
      }
    });
  });
}

// 生成模型标签的函数
function generateModelTag(modelId) {
  if (!modelId) return '';
  // 替换特殊字符，只保留字母数字和连字符
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// 编码模型ID为Kubernetes标签兼容格式
function encodeModelIdForLabel(modelId) {
  if (!modelId) return '';
  
  // 对于常见的模型ID格式，使用简化的编码方式
  // 例如: Qwen/Qwen3-0.6B -> qwen3-06b
  //      microsoft/DialoGPT-medium -> microsoft-dialogpt-medium
  
  return modelId
    .toLowerCase()                    // 转为小写
    .replace(/\//g, '-')             // 斜杠替换为连字符
    .replace(/\./g, '')              // 移除点号
    .replace(/[^a-z0-9-]/g, '-')     // 其他特殊字符替换为连字符
    .replace(/-+/g, '-')             // 合并多个连字符
    .replace(/^-|-$/g, '');          // 移除首尾连字符
}

// 解码Kubernetes标签为原始模型ID
// 注意：由于使用了简化编码，这个函数主要用于向后兼容
// 新的编码方式是不可逆的，实际的模型ID应该从其他地方获取
function decodeModelIdFromLabel(encodedModelId) {
  if (!encodedModelId) return '';
  
  // 尝试处理旧的编码格式（向后兼容）
  if (encodedModelId.includes('--slash--')) {
    return encodedModelId
      .replace(/--slash--/g, '/')
      .replace(/--colon--/g, ':')
      .replace(/--dot--/g, '.')
      .replace(/--at--/g, '@')
      .replace(/--plus--/g, '+')
      .replace(/--equals--/g, '=')
      .replace(/--space--/g, ' ');
  }
  
  // 对于新的简化编码，直接返回（因为是不可逆的）
  return encodedModelId;
}

// 从VLLM命令中提取模型ID
function extractModelIdFromVllmCommand(vllmCommandString) {
  if (!vllmCommandString) return '';
  
  // 清理命令字符串
  const cleanCommand = vllmCommandString
    .replace(/\\\s*\n/g, ' ')  // 处理反斜杠换行
    .replace(/\s+/g, ' ')      // 合并多个空格
    .trim();
  
  // 分割成参数数组
  const args = cleanCommand.split(/\s+/);
  
  // 查找--model参数
  const modelIndex = args.findIndex(arg => arg === '--model');
  if (modelIndex !== -1 && modelIndex + 1 < args.length) {
    return args[modelIndex + 1];
  }
  
  return '';
}

// 生成NLB注解的函数
function generateNLBAnnotations(isExternal) {
  if (isExternal) {
    return `
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"`;
  } else {
    return `
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internal"`;
  }
}

// 解析完整的VLLM命令
function parseVllmCommand(vllmCommandString) {
  // 移除换行符和多余空格，处理反斜杠换行
  const cleanCommand = vllmCommandString
    .replace(/\\\s*\n/g, ' ')  // 处理反斜杠换行
    .replace(/\s+/g, ' ')      // 合并多个空格
    .trim();
  
  // 分割命令为数组
  const parts = cleanCommand.split(' ').filter(part => part.trim());
  
  // 验证命令格式
  if (!parts.includes('python3') || !parts.includes('-m') || !parts.includes('vllm.entrypoints.openai.api_server')) {
    throw new Error('Invalid VLLM command format. Must start with: python3 -m vllm.entrypoints.openai.api_server');
  }
  
  // 找到entrypoint后的参数
  const entrypointIndex = parts.findIndex(part => part === 'vllm.entrypoints.openai.api_server');
  const args = parts.slice(entrypointIndex + 1);
  
  // 解析tensor-parallel-size用于GPU配置
  let tensorParallelSize = 1;
  const tensorParallelIndex = args.findIndex(arg => arg === '--tensor-parallel-size');
  if (tensorParallelIndex !== -1 && tensorParallelIndex + 1 < args.length) {
    tensorParallelSize = parseInt(args[tensorParallelIndex + 1]) || 1;
  }
  
  return {
    fullCommand: parts,
    args: args,
    tensorParallelSize: tensorParallelSize
  };
}

// 改进的HTTP请求代理函数
function makeHttpRequest(url, payload) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      const postData = JSON.stringify(payload);
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Model-Deployment-UI/1.0'
        },
        timeout: 30000 // 30秒超时
      };
      
      console.log(`Making HTTP request to: ${url}`);
      console.log(`Request options:`, JSON.stringify(options, null, 2));
      console.log(`Payload:`, postData);
      
      const req = httpModule.request(options, (res) => {
        let data = '';
        
        console.log(`Response status: ${res.statusCode}`);
        console.log(`Response headers:`, JSON.stringify(res.headers, null, 2));
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          console.log(`Response data:`, data);
          
          // 处理不同的响应状态
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // 成功响应
            try {
              const jsonData = JSON.parse(data);
              resolve({
                success: true,
                status: res.statusCode,
                data: jsonData
              });
            } catch (parseError) {
              // 如果不是JSON，返回原始文本
              console.log('Response is not JSON, returning as text');
              resolve({
                success: true,
                status: res.statusCode,
                data: data,
                isText: true
              });
            }
          } else {
            // 错误响应
            try {
              const errorData = JSON.parse(data);
              resolve({
                success: false,
                status: res.statusCode,
                error: errorData.error || `HTTP ${res.statusCode}`,
                data: errorData
              });
            } catch (parseError) {
              resolve({
                success: false,
                status: res.statusCode,
                error: `HTTP ${res.statusCode}: ${data}`,
                data: data
              });
            }
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('HTTP request error:', error);
        reject({
          success: false,
          error: `Network error: ${error.message}`
        });
      });
      
      req.on('timeout', () => {
        console.error('HTTP request timeout');
        req.destroy();
        reject({
          success: false,
          error: 'Request timeout (30s)'
        });
      });
      
      req.write(postData);
      req.end();
      
    } catch (error) {
      console.error('HTTP request setup error:', error);
      reject({
        success: false,
        error: `Request setup error: ${error.message}`
      });
    }
  });
}

// 获取集群节点GPU使用情况
app.get('/api/cluster-status', async (req, res) => {
  try {
    console.log('Fetching cluster status...');
    // 获取节点信息
    const nodesOutput = await executeKubectl('get nodes -o json');
    const nodes = JSON.parse(nodesOutput);
    
    // 获取GPU使用情况
    const gpuUsage = [];
    for (const node of nodes.items) {
      const nodeName = node.metadata.name;
      try {
        const gpuInfo = await executeKubectl(`describe node ${nodeName}`);
        
        // 解析GPU信息
        const capacityMatch = gpuInfo.match(/nvidia\.com\/gpu:\s*(\d+)/);
        const allocatableMatch = gpuInfo.match(/nvidia\.com\/gpu:\s*(\d+)/g);
        const requestsMatch = gpuInfo.match(/nvidia\.com\/gpu\s+(\d+)/);
        
        let totalGPU = 0;
        let usedGPU = 0;
        
        if (capacityMatch) {
          totalGPU = parseInt(capacityMatch[1]);
        }
        
        if (requestsMatch) {
          usedGPU = parseInt(requestsMatch[1]);
        }
        
        gpuUsage.push({
          nodeName,
          totalGPU,
          usedGPU,
          availableGPU: totalGPU - usedGPU
        });
      } catch (error) {
        gpuUsage.push({
          nodeName,
          totalGPU: 0,
          usedGPU: 0,
          availableGPU: 0,
          error: 'Unable to fetch GPU info'
        });
      }
    }
    
    console.log('Cluster status fetched:', gpuUsage.length, 'nodes');
    res.json({ nodes: gpuUsage });
  } catch (error) {
    console.error('Cluster status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取Pod状态
app.get('/api/pods', async (req, res) => {
  try {
    console.log('Fetching pods...');
    const output = await executeKubectl('get pods -o json');
    const pods = JSON.parse(output);
    console.log('Pods fetched:', pods.items.length, 'pods');
    res.json(pods.items);
  } catch (error) {
    console.error('Pods fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取Service状态
app.get('/api/services', async (req, res) => {
  try {
    console.log('Fetching services...');
    const output = await executeKubectl('get services -o json');
    const services = JSON.parse(output);
    console.log('Services fetched:', services.items.length, 'services');
    res.json(services.items);
  } catch (error) {
    console.error('Services fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 代理HTTP请求到模型服务
app.post('/api/proxy-request', async (req, res) => {
  try {
    const { url, payload } = req.body;
    
    if (!url || payload === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing url or payload'
      });
    }
    
    console.log(`Proxying request to: ${url}`);
    console.log(`Payload:`, JSON.stringify(payload, null, 2));
    
    const result = await makeHttpRequest(url, payload);
    
    console.log('Proxy result:', JSON.stringify(result, null, 2));
    res.json(result);
    
  } catch (error) {
    console.error('Proxy request error:', error);
    res.json({
      success: false,
      error: error.error || error.message || 'Request failed'
    });
  }
});

// 生成并部署YAML配置
app.post('/api/deploy', async (req, res) => {
  try {
    const {
      replicas,
      huggingFaceToken,
      deploymentType,
      vllmCommand,
      ollamaModelId,
      gpuCount,
      isExternal = true,  // 默认为external
      modelId  // 添加modelId参数，用于VLLM部署
    } = req.body;

    console.log('Deployment request:', { 
      deploymentType, 
      ollamaModelId, 
      replicas, 
      isExternal 
    });

    let templatePath, newYamlContent, finalModelTag;

    // 生成NLB注解
    const nlbAnnotations = generateNLBAnnotations(isExternal);
    console.log(`Generated NLB annotations (external: ${isExternal}):`, nlbAnnotations);

    if (deploymentType === 'ollama') {
      // 处理Ollama部署 - 使用模型ID生成标签
      finalModelTag = generateModelTag(ollamaModelId);
      console.log(`Generated model tag from "${ollamaModelId}": "${finalModelTag}"`);
      
      templatePath = path.join(__dirname, '../templates/ollama-template.yaml');
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      // 替换模板中的占位符 - 注意顺序：先替换更具体的占位符
      newYamlContent = templateContent
        .replace(/ENCODED_MODEL_ID/g, encodeModelIdForLabel(ollamaModelId)) // 先替换ENCODED_MODEL_ID
        .replace(/MODEL_TAG/g, finalModelTag)
        .replace(/OLLAMA_MODEL_ID/g, ollamaModelId)
        .replace(/REPLICAS_COUNT/g, replicas.toString())
        .replace(/GPU_COUNT/g, gpuCount.toString())
        .replace(/NLB_ANNOTATIONS/g, nlbAnnotations);
      
    } else {
      // 处理VLLM部署
      const parsedCommand = parseVllmCommand(vllmCommand);
      console.log('Parsed VLLM command:', parsedCommand);
      
      // 从VLLM命令中提取模型ID
      const extractedModelId = extractModelIdFromVllmCommand(vllmCommand);
      console.log(`Extracted model ID from VLLM command: "${extractedModelId}"`);
      
      // 基于提取的模型ID自动生成tag
      finalModelTag = generateModelTag(extractedModelId);
      console.log(`Auto-generated model tag from "${extractedModelId}": "${finalModelTag}"`);
      
      // 编码模型ID用于Kubernetes标签
      const encodedModelId = encodeModelIdForLabel(extractedModelId);
      console.log(`Encoded model ID: "${encodedModelId}"`);

      templatePath = path.join(__dirname, '../templates/vllm-template.yaml');
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      // 生成HuggingFace token环境变量（如果提供了token）
      let hfTokenEnv = '';
      if (huggingFaceToken && huggingFaceToken.trim() !== '') {
        hfTokenEnv = `
            - name: HUGGING_FACE_HUB_TOKEN
              value: "${huggingFaceToken}"`;
      }
      
      // 替换模板中的占位符 - 注意顺序：先替换更具体的占位符
      newYamlContent = templateContent
        .replace(/ENCODED_MODEL_ID/g, encodedModelId) // 先替换ENCODED_MODEL_ID
        .replace(/MODEL_TAG/g, finalModelTag)
        .replace(/MODEL_ID/g, extractedModelId) // 然后替换MODEL_ID
        .replace(/REPLICAS_COUNT/g, replicas.toString())
        .replace(/GPU_COUNT/g, parsedCommand.tensorParallelSize.toString())
        .replace(/HF_TOKEN_ENV/g, hfTokenEnv)
        .replace(/VLLM_COMMAND/g, JSON.stringify(parsedCommand.fullCommand))
        .replace(/NLB_ANNOTATIONS/g, nlbAnnotations);
    }
    
    // 保存到项目目录中的deployments文件夹
    const deploymentsDir = path.join(__dirname, '../deployments');
    await fs.ensureDir(deploymentsDir); // 确保目录存在
    
    const accessType = isExternal ? 'external' : 'internal';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const tempYamlPath = path.join(deploymentsDir, `${finalModelTag}-${deploymentType}-${accessType}-${timestamp}.yaml`);
    await fs.writeFile(tempYamlPath, newYamlContent);
    
    console.log(`Generated YAML saved to: ${tempYamlPath}`);
    
    // 执行kubectl apply
    const applyOutput = await executeKubectl(`apply -f ${tempYamlPath}`);
    
    // 广播部署状态更新
    broadcast({
      type: 'deployment',
      status: 'success',
      message: `Successfully deployed ${deploymentType.toUpperCase()} model: ${finalModelTag} (${accessType} access)`,
      output: applyOutput
    });
    
    res.json({
      success: true,
      message: 'Deployment successful',
      output: applyOutput,
      yamlPath: tempYamlPath,
      generatedYaml: newYamlContent,
      deploymentType,
      modelTag: finalModelTag,
      accessType
    });
    
  } catch (error) {
    console.error('Deployment error:', error);
    
    broadcast({
      type: 'deployment',
      status: 'error',
      message: `Deployment failed: ${error.message}`
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 删除部署 - 改进版本
app.post('/api/undeploy', async (req, res) => {
  try {
    const { modelTag, deleteType } = req.body;
    
    if (!modelTag) {
      return res.status(400).json({
        success: false,
        error: 'Model tag is required'
      });
    }
    
    console.log(`Undeploying model: ${modelTag}, type: ${deleteType}`);
    
    // 构建可能的资源名称
    const possibleDeployments = [
      `vllm-${modelTag}-inference`,
      `olm-${modelTag}-inference`,
      `${modelTag}-inference`  // 备用格式
    ];
    
    const possibleServices = [
      `vllm-${modelTag}-nlb`,
      `${modelTag}-nlb`,
      `${modelTag}-service`  // 备用格式
    ];
    
    let deleteCommands = [];
    let deletedResources = [];
    
    // 根据删除类型决定删除哪些资源
    if (deleteType === 'all' || deleteType === 'deployment') {
      possibleDeployments.forEach(deploymentName => {
        deleteCommands.push(`delete deployment ${deploymentName} --ignore-not-found=true`);
      });
      deletedResources.push('Deployment');
    }
    
    if (deleteType === 'all' || deleteType === 'service') {
      possibleServices.forEach(serviceName => {
        deleteCommands.push(`delete service ${serviceName} --ignore-not-found=true`);
      });
      deletedResources.push('Service');
    }
    
    // 执行删除命令
    const results = [];
    let actuallyDeleted = 0;
    
    for (const command of deleteCommands) {
      try {
        const output = await executeKubectl(command);
        const success = !output.includes('not found');
        results.push({
          command,
          success: true,
          output: output.trim(),
          actuallyDeleted: success
        });
        if (success) actuallyDeleted++;
      } catch (error) {
        results.push({
          command,
          success: false,
          error: error.error || error.message,
          actuallyDeleted: false
        });
      }
    }
    
    // 等待一下让资源完全删除
    if (actuallyDeleted > 0) {
      console.log(`Waiting for resources to be fully deleted...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // 广播删除状态更新
    broadcast({
      type: 'undeployment',
      status: 'success',
      message: `Successfully deleted resources for ${modelTag} (${actuallyDeleted} resources)`,
      results: results
    });
    
    res.json({
      success: true,
      message: actuallyDeleted > 0 
        ? `Successfully deleted ${actuallyDeleted} resource(s)` 
        : 'No resources found to delete (may already be deleted)',
      deletedResources: deletedResources,
      results: results,
      modelTag: modelTag,
      actuallyDeleted: actuallyDeleted
    });
    
  } catch (error) {
    console.error('Undeploy error:', error);
    
    broadcast({
      type: 'undeployment',
      status: 'error',
      message: `Failed to undeploy ${req.body.modelTag}: ${error.message}`
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取部署详细信息（包含模型元数据）
app.get('/api/deployment-details', async (req, res) => {
  try {
    console.log('Fetching deployment details with metadata...');
    
    // 获取所有deployment
    const deploymentsOutput = await executeKubectl('get deployments -o json');
    const deployments = JSON.parse(deploymentsOutput);
    
    // 获取所有service
    const servicesOutput = await executeKubectl('get services -o json');
    const services = JSON.parse(servicesOutput);
    
    // 过滤出模型相关的部署并提取元数据
    const modelDeployments = deployments.items
      .filter(deployment => 
        deployment.metadata.name.includes('vllm') || 
        deployment.metadata.name.includes('olm') ||
        deployment.metadata.name.includes('inference')
      )
      .map(deployment => {
        const labels = deployment.metadata.labels || {};
        const appLabel = labels.app;
        
        // 查找对应的service
        const matchingService = services.items.find(service => 
          service.spec.selector?.app === appLabel
        );
        
        // 从标签中提取模型信息
        const modelType = labels['model-type'] || 'unknown';
        const encodedModelId = labels['model-id'] || 'unknown';
        const modelTag = labels['model-tag'] || 'unknown';
        
        // 确定最终的模型ID - 优先从容器命令中提取原始ID
        let modelId = 'unknown';
        
        // 对于VLLM部署，从容器命令中提取原始模型ID
        if (modelType === 'vllm') {
          try {
            const containers = deployment.spec?.template?.spec?.containers || [];
            const vllmContainer = containers.find(c => c.name === 'vllm-openai');
            if (vllmContainer && vllmContainer.command) {
              const command = vllmContainer.command;
              const modelIndex = command.findIndex(arg => arg === '--model');
              if (modelIndex !== -1 && modelIndex + 1 < command.length) {
                modelId = command[modelIndex + 1]; // 获取--model参数后的值
              }
            }
          } catch (error) {
            console.log('Failed to extract model ID from VLLM command:', error.message);
          }
        }
        
        // 对于Ollama部署，从postStart生命周期钩子中提取模型ID
        if (modelType === 'ollama' && modelId === 'unknown') {
          try {
            const containers = deployment.spec?.template?.spec?.containers || [];
            const ollamaContainer = containers.find(c => c.name === 'ollama');
            if (ollamaContainer && ollamaContainer.lifecycle?.postStart?.exec?.command) {
              const command = ollamaContainer.lifecycle.postStart.exec.command;
              // 查找包含"ollama pull"的命令
              const commandStr = command.join(' ');
              const pullMatch = commandStr.match(/ollama pull ([^\s\\]+)/);
              if (pullMatch) {
                modelId = pullMatch[1]; // 提取模型ID
                console.log('Extracted Ollama model ID from postStart:', modelId);
              }
            }
          } catch (error) {
            console.log('Failed to extract model ID from Ollama postStart command:', error.message);
          }
        }
        
        // 对于无法提取的情况，使用解码逻辑
        if (modelId === 'unknown' && encodedModelId !== 'unknown') {
          modelId = decodeModelIdFromLabel(encodedModelId);
        }
        
        // 获取服务URL
        let serviceUrl = '';
        if (matchingService) {
          const ingress = matchingService.status?.loadBalancer?.ingress?.[0];
          if (ingress) {
            const host = ingress.hostname || ingress.ip;
            const port = matchingService.spec.ports?.[0]?.port || 8000;
            serviceUrl = `http://${host}:${port}`;
          }
        }
        
        return {
          deploymentName: deployment.metadata.name,
          serviceName: matchingService?.metadata.name || 'N/A',
          modelType: modelType,
          modelId: modelId,
          modelTag: modelTag,
          serviceUrl: serviceUrl,
          status: deployment.status.readyReplicas === deployment.spec.replicas ? 'Ready' : 'Pending',
          replicas: deployment.spec.replicas,
          readyReplicas: deployment.status.readyReplicas || 0,
          hasService: !!matchingService,
          isExternal: matchingService?.metadata?.annotations?.['service.beta.kubernetes.io/aws-load-balancer-scheme'] === 'internet-facing'
        };
      });
    
    console.log('Deployment details fetched:', modelDeployments.length, 'deployments');
    res.json(modelDeployments);
    
  } catch (error) {
    console.error('Deployment details fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取已部署的模型列表
app.get('/api/deployments', async (req, res) => {
  try {
    console.log('Fetching deployments...');
    
    // 获取所有deployment
    const deploymentsOutput = await executeKubectl('get deployments -o json');
    const deployments = JSON.parse(deploymentsOutput);
    
    // 获取所有service
    const servicesOutput = await executeKubectl('get services -o json');
    const services = JSON.parse(servicesOutput);
    
    // 过滤出VLLM和Ollama相关的部署
    const modelDeployments = deployments.items.filter(deployment => 
      deployment.metadata.name.includes('vllm') || 
      deployment.metadata.name.includes('olm') ||
      deployment.metadata.name.includes('inference')
    );
    
    // 为每个部署匹配对应的service
    const deploymentList = modelDeployments.map(deployment => {
      const appLabel = deployment.metadata.labels?.app;
      const matchingService = services.items.find(service => 
        service.spec.selector?.app === appLabel
      );
      
      // 从deployment名称提取model tag和类型
      const deploymentName = deployment.metadata.name;
      let modelTag = 'unknown';
      let deploymentType = 'unknown';
      
      if (deploymentName.startsWith('vllm-') && deploymentName.endsWith('-inference')) {
        modelTag = deploymentName.slice(5, -10); // 移除 'vllm-' 前缀和 '-inference' 后缀
        deploymentType = 'VLLM';
      } else if (deploymentName.startsWith('olm-') && deploymentName.endsWith('-inference')) {
        modelTag = deploymentName.slice(4, -10); // 移除 'olm-' 前缀和 '-inference' 后缀
        deploymentType = 'Ollama';
      }
      
      // 检查是否为external访问
      const isExternal = matchingService?.metadata?.annotations?.['service.beta.kubernetes.io/aws-load-balancer-scheme'] === 'internet-facing';
      
      return {
        modelTag,
        deploymentType,
        deploymentName: deployment.metadata.name,
        serviceName: matchingService?.metadata.name || 'N/A',
        replicas: deployment.spec.replicas,
        readyReplicas: deployment.status.readyReplicas || 0,
        status: deployment.status.readyReplicas === deployment.spec.replicas ? 'Ready' : 'Pending',
        createdAt: deployment.metadata.creationTimestamp,
        hasService: !!matchingService,
        serviceType: matchingService?.spec.type || 'N/A',
        isExternal: isExternal,
        externalIP: matchingService?.status?.loadBalancer?.ingress?.[0]?.hostname || 
                   matchingService?.status?.loadBalancer?.ingress?.[0]?.ip || 'Pending'
      };
    });
    
    console.log('Deployments fetched:', deploymentList.length, 'model deployments');
    res.json(deploymentList);
    
  } catch (error) {
    console.error('Deployments fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 测试模型API（生成cURL命令）
app.post('/api/test-model', async (req, res) => {
  const { serviceUrl, payload } = req.body;
  
  try {
    let parsedPayload;
    
    try {
      parsedPayload = JSON.parse(payload);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    
    const curlCommand = `curl -X POST "${serviceUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(parsedPayload, null, 2)}'`;
    
    res.json({
      curlCommand,
      fullUrl: serviceUrl,
      message: 'Use the curl command to test your model'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket连接处理
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // 立即发送一次状态更新
  const sendStatusUpdate = async () => {
    try {
      const [pods, services] = await Promise.all([
        executeKubectl('get pods -o json').then(output => JSON.parse(output).items),
        executeKubectl('get services -o json').then(output => JSON.parse(output).items)
      ]);
      
      const statusData = {
        type: 'status_update',
        pods,
        services
      };
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(statusData));
        console.log(`Sent status update: ${pods.length} pods, ${services.length} services`);
      }
    } catch (error) {
      console.error('Error fetching status for WebSocket:', error);
    }
  };
  
  // 立即发送一次
  sendStatusUpdate();
  
  // 定期发送Pod和Service状态更新
  const interval = setInterval(sendStatusUpdate, 60000); // 每60秒（1分钟）更新一次
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clearInterval(interval);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(interval);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on port ${WS_PORT}`);
});
