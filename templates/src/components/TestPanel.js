import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Input,
  Button, 
  Select, 
  Card, 
  Typography, 
  Space,
  Divider,
  Alert,
  message,
  Spin
} from 'antd';
import { 
  SendOutlined, 
  CopyOutlined, 
  ApiOutlined,
  ThunderboltOutlined,
  CodeOutlined,
  LinkOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { CONFIG } from '../config/constants';

const { TextArea } = Input;
const { Option } = Select;
const { Text, Paragraph } = Typography;

const TestPanel = ({ services }) => {
  const [form] = Form.useForm();
  const [curlCommand, setCurlCommand] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [modelType, setModelType] = useState('ollama'); // 'ollama' or 'vllm'
  const [deploymentDetails, setDeploymentDetails] = useState([]); // 存储部署详情

  // 过滤出模型相关的服务
  const modelServices = services.filter(service => 
    service.metadata.name.includes('vllm') || 
    service.metadata.name.includes('olm') ||
    service.metadata.name.includes('model') ||
    service.metadata.name.includes('gpt') ||
    service.metadata.name.includes('nlb') ||
    service.spec.type === 'LoadBalancer'
  );

  // 获取部署详情
  const fetchDeploymentDetails = async () => {
    try {
      const response = await fetch('/api/deployment-details');
      const details = await response.json();
      setDeploymentDetails(details);
      console.log('Deployment details loaded:', details);
    } catch (error) {
      console.error('Failed to fetch deployment details:', error);
    }
  };

  // 手动刷新服务列表
  const handleRefresh = () => {
    fetchDeploymentDetails();
    message.success('Services refreshed');
  };

  // 根据服务名获取对应的部署详情
  const getDeploymentDetailByService = (service) => {
    if (!service || !deploymentDetails.length) return null;
    
    const serviceName = service.metadata.name;
    return deploymentDetails.find(detail => detail.serviceName === serviceName);
  };

  // 获取真实的模型ID
  const getRealModelId = (service) => {
    console.log('getRealModelId called with service:', service?.metadata?.name);
    console.log('deploymentDetails:', deploymentDetails);
    
    const detail = getDeploymentDetailByService(service);
    console.log('Found deployment detail:', detail);
    
    if (detail && detail.modelId !== 'unknown') {
      console.log('Using modelId from detail:', detail.modelId);
      return detail.modelId;
    }
    
    // Fallback到原来的逻辑
    const fallbackId = getModelIdFromService(service);
    console.log('Using fallback modelId:', fallbackId);
    return fallbackId;
  };

  // 检测模型类型
  const detectModelType = (service) => {
    if (!service) return 'ollama';
    
    // 首先尝试从部署详情获取
    const detail = getDeploymentDetailByService(service);
    if (detail && detail.modelType !== 'unknown') {
      return detail.modelType;
    }
    
    // Fallback到服务名检测
    const serviceName = service.metadata.name.toLowerCase();
    if (serviceName.includes('vllm')) {
      return 'vllm';
    } else if (serviceName.includes('olm') || serviceName.includes('ollama')) {
      return 'ollama';
    }
    // 默认返回ollama
    return 'ollama';
  };

  // 获取模型ID从服务名称
  const getModelIdFromService = (service) => {
    if (!service) return 'unknown';
    
    const serviceName = service.metadata.name;
    
    // 对于VLLM服务
    if (serviceName.includes('vllm-') && serviceName.includes('-nlb')) {
      const modelTag = serviceName.replace('vllm-', '').replace('-nlb', '');
      // 尝试从模型标签推断原始模型ID
      // 例如: qwen-qwen3-0-6b -> Qwen/Qwen3-0.6B (这是一个近似推断)
      if (modelTag.includes('qwen')) {
        return modelTag; // 对于VLLM，暂时返回标签格式
      }
      return modelTag;
    }
    
    // 对于新格式的ollama服务 (olm-xxx-nlb)
    if (serviceName.includes('olm-') && serviceName.includes('-nlb')) {
      const modelTag = serviceName.replace('olm-', '').replace('-nlb', '');
      
      // 根据已知的模式推断模型ID
      if (modelTag === 'gpt120b') {
        return 'gpt-oss:120b';
      } else if (modelTag === 'gpt20b') {
        return 'gpt-oss:20b';
      }
      
      // 通用转换：将连字符转换为冒号
      return modelTag.replace(/-/g, ':');
    }
    
    // 对于gpt-oss格式的服务 (gpt-oss-xxx-nlb)
    if (serviceName.includes('gpt-oss-') && serviceName.includes('-nlb')) {
      const modelTag = serviceName.replace('gpt-oss-', '').replace('-nlb', '');
      return `gpt-oss:${modelTag}`;
    }
    
    // 对于旧格式的服务 (gpt-xxx-nlb) - 处理现有的部署
    if (serviceName.includes('gpt-') && serviceName.includes('-nlb')) {
      const modelTag = serviceName.replace('gpt-', '').replace('-nlb', '');
      
      // 根据已知的模式推断模型ID
      if (modelTag === '120b') {
        return 'gpt-oss:120b';
      } else if (modelTag === '20b') {
        return 'gpt-oss:20b';
      }
      
      // 通用转换
      return `gpt-oss:${modelTag}`;
    }
    
    // 默认返回服务名
    return serviceName;
  };

  useEffect(() => {
    // 初始获取部署详情
    fetchDeploymentDetails();
    
    // 设置自动刷新，使用全局配置的间隔
    const interval = setInterval(() => {
      fetchDeploymentDetails();
    }, CONFIG.AUTO_REFRESH_INTERVAL);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (modelServices.length > 0 && !selectedService && deploymentDetails.length > 0) {
      const firstService = modelServices[0];
      setSelectedService(firstService);
      const detectedType = detectModelType(firstService);
      setModelType(detectedType);
      
      // 根据模型类型设置默认值
      updateFormDefaults(detectedType, firstService);
    }
  }, [modelServices, selectedService, deploymentDetails]);

  // 更新表单默认值
  const updateFormDefaults = (type, service) => {
    if (type === 'vllm') {
      const realModelId = getRealModelId(service);
      form.setFieldsValue({
        apiPath: '/v1/chat/completions',
        payload: JSON.stringify({
          model: realModelId, // 使用真实的模型ID
          messages: [
            {
              role: "user",
              content: "Hello, how are you today?"
            }
          ],
          max_tokens: 100,
          temperature: 0.7
        }, null, 2)
      });
    } else {
      const realModelId = getRealModelId(service);
      form.setFieldsValue({
        apiPath: '/api/generate',
        payload: JSON.stringify({
          model: realModelId, // 使用真实的模型ID
          prompt: "Hello, how are you today?",
          stream: false
        }, null, 2)
      });
    }
  };

  const getServiceUrl = (service) => {
    if (!service) return '';
    
    // 尝试获取LoadBalancer的外部IP
    const ingress = service.status?.loadBalancer?.ingress?.[0];
    if (ingress) {
      const host = ingress.hostname || ingress.ip;
      const port = service.spec.ports?.[0]?.port || 8000;
      return `http://${host}:${port}`;
    }
    
    // 如果没有外部IP，使用ClusterIP
    const clusterIP = service.spec.clusterIP;
    const port = service.spec.ports?.[0]?.port || 8000;
    return `http://${clusterIP}:${port}`;
  };

  const handleServiceChange = (serviceName) => {
    const service = modelServices.find(s => s.metadata.name === serviceName);
    setSelectedService(service);
    
    // 检测并设置模型类型
    const detectedType = detectModelType(service);
    setModelType(detectedType);
    
    // 更新表单默认值
    updateFormDefaults(detectedType, service);
  };

  const generateCurlCommand = async (values) => {
    if (!selectedService) {
      message.error('Please select a service first');
      return;
    }

    setLoading(true);
    try {
      const serviceUrl = getServiceUrl(selectedService);
      const { apiPath, payload } = values;
      
      // 验证JSON payload
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (error) {
        message.error('Invalid JSON format in payload');
        setLoading(false);
        return;
      }

      const fullUrl = `${serviceUrl}${apiPath}`;
      
      const curlCmd = `curl -X POST "${fullUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(parsedPayload, null, 2)}'`;
      
      setCurlCommand(curlCmd);
      
    } catch (error) {
      console.error('Error generating curl command:', error);
      message.error('Failed to generate curl command');
    } finally {
      setLoading(false);
    }
  };

  const testModelDirectly = async (values) => {
    if (!selectedService) {
      message.error('Please select a service first');
      return;
    }

    setTestLoading(true);
    setResponse('');
    
    try {
      const serviceUrl = getServiceUrl(selectedService);
      const { apiPath, payload } = values;
      
      // 验证JSON payload
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (error) {
        message.error('Invalid JSON format in payload');
        setTestLoading(false);
        return;
      }

      const fullUrl = `${serviceUrl}${apiPath}`;
      
      // 通过后端代理请求
      const response = await fetch('/api/proxy-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: fullUrl,
          payload: parsedPayload
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setResponse(JSON.stringify(result.data, null, 2));
        message.success('Request successful');
      } else {
        setResponse(`Error (${result.status}): ${result.error}\n\nDetails:\n${JSON.stringify(result.data, null, 2)}`);
        message.warning('Request returned an error (see response for details)');
      }
      
    } catch (error) {
      console.error('Error testing model:', error);
      setResponse(`Network Error: ${error.message}`);
      message.error('Failed to test model');
    } finally {
      setTestLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('Copied to clipboard');
    });
  };

  const getServiceStatus = (service) => {
    if (!service) return 'unknown';
    
    const ingress = service.status?.loadBalancer?.ingress;
    if (ingress && ingress.length > 0) {
      return 'ready';
    }
    
    if (service.spec.type === 'LoadBalancer') {
      return 'pending';
    }
    
    return 'internal';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return 'success';
      case 'pending': return 'warning';
      case 'internal': return 'processing';
      default: return 'default';
    }
  };

  return (
    <div>
      {/* 服务选择 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text strong>
              <ApiOutlined /> Select Model Service
            </Text>
            <Button 
              type="text" 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh}
              size="small"
              title="Refresh services"
            >
              Refresh
            </Button>
          </div>
          
          {modelServices.length === 0 ? (
            <Alert
              message="No model services found"
              description="Deploy a model first to see available services"
              type="info"
              showIcon
            />
          ) : (
            <Select
              style={{ width: '100%' }}
              placeholder="Select a service"
              value={selectedService?.metadata.name}
              onChange={handleServiceChange}
            >
              {modelServices.map(service => {
                const serviceType = detectModelType(service);
                return (
                  <Option key={service.metadata.name} value={service.metadata.name}>
                    <Space>
                      {service.metadata.name}
                      <Text type="secondary">
                        ({serviceType.toUpperCase()} - {getServiceStatus(service)})
                      </Text>
                    </Space>
                  </Option>
                );
              })}
            </Select>
          )}

          {/* 显示选中服务的URL */}
          {selectedService && (
            <div style={{ marginTop: 8, padding: 8, backgroundColor: '#f6f8fa', borderRadius: 4 }}>
              <Text strong>Base URL: </Text>
              <Text code>{getServiceUrl(selectedService)}</Text>
            </div>
          )}
        </Space>
      </Card>

      {/* 测试表单 */}
      <Form
        form={form}
        layout="vertical"
        onFinish={generateCurlCommand}
      >
        <Form.Item
          label={
            <Space>
              <LinkOutlined />
              API Path
            </Space>
          }
          name="apiPath"
          rules={[
            { required: true, message: 'Please input API path!' },
            { pattern: /^\//, message: 'API path must start with /' }
          ]}
        >
          <Input 
            placeholder="/api/generate"
            addonBefore="Base URL"
          />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <CodeOutlined />
              JSON Payload
            </Space>
          }
          name="payload"
          rules={[
            { required: true, message: 'Please input JSON payload!' },
            {
              validator: (_, value) => {
                try {
                  JSON.parse(value);
                  return Promise.resolve();
                } catch (error) {
                  return Promise.reject(new Error('Invalid JSON format'));
                }
              }
            }
          ]}
        >
          <TextArea
            rows={6}
            placeholder="Enter JSON payload here..."
            style={{ fontFamily: 'monospace', fontSize: '13px' }}
          />
        </Form.Item>

        <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f6f8fa', borderRadius: 6 }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: 8 }}>
            <strong>{modelType.toUpperCase()} API示例：</strong>
          </div>
          <div style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace' }}>
            {modelType === 'vllm' ? (
              <>
                /v1/chat/completions - 对话API (OpenAI兼容)<br/>
                /v1/completions - 文本补全API<br/>
                /v1/models - 模型列表 (GET请求)<br/>
                /health - 健康检查<br/>
                <Text style={{ color: '#0066cc', fontSize: '11px' }}>
                  当前模型: {getRealModelId(selectedService)}
                </Text>
              </>
            ) : (
              <>
                /api/generate - 文本生成 (使用 {getRealModelId(selectedService)})<br/>
                /api/chat - 对话API (使用 {getRealModelId(selectedService)})<br/>
                /api/tags - 模型列表 (GET请求，payload为空)<br/>
                / - 健康检查<br/>
                <Text style={{ color: '#0066cc', fontSize: '11px' }}>
                  当前模型: {getRealModelId(selectedService)}
                </Text>
              </>
            )}
          </div>
        </div>

        <Space style={{ width: '100%' }} size="middle">
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading}
            icon={<ThunderboltOutlined />}
            style={{ flex: 1 }}
            disabled={!selectedService}
          >
            Generate cURL
          </Button>
          
          <Button 
            type="default" 
            loading={testLoading}
            icon={<SendOutlined />}
            style={{ flex: 1 }}
            disabled={!selectedService}
            onClick={() => {
              form.validateFields().then(values => {
                testModelDirectly(values);
              });
            }}
          >
            Test Directly
          </Button>
        </Space>
      </Form>

      <Divider />

      {/* cURL命令展示 */}
      {curlCommand && (
        <Card 
          title={
            <Space>
              <ThunderboltOutlined />
              Generated cURL Command
            </Space>
          }
          size="small"
          extra={
            <Button 
              size="small" 
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(curlCommand)}
            >
              Copy
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Paragraph
            code
            copyable
            style={{ 
              backgroundColor: '#f6f8fa', 
              padding: 12, 
              borderRadius: 6,
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {curlCommand}
          </Paragraph>
        </Card>
      )}

      {/* 响应结果展示 */}
      {(response || testLoading) && (
        <Card 
          title={
            <Space>
              <SendOutlined />
              Response
            </Space>
          }
          size="small"
          extra={
            response && (
              <Button 
                size="small" 
                icon={<CopyOutlined />}
                onClick={() => copyToClipboard(response)}
              >
                Copy
              </Button>
            )
          }
        >
          {testLoading ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Spin size="large" />
              <div style={{ marginTop: 16 }}>Testing model...</div>
            </div>
          ) : (
            <pre style={{ 
              backgroundColor: '#f6f8fa', 
              padding: 12, 
              borderRadius: 6,
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '300px',
              overflow: 'auto'
            }}>
              {response}
            </pre>
          )}
        </Card>
      )}

      {/* 服务状态信息 */}
      {selectedService && (
        <Card 
          title="Service Details" 
          size="small" 
          style={{ marginTop: 16 }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text strong>Name:</Text> {selectedService.metadata.name}
            </div>
            <div>
              <Text strong>Type:</Text> {selectedService.spec.type}
            </div>
            <div>
              <Text strong>Status:</Text>{' '}
              <Text type={getStatusColor(getServiceStatus(selectedService))}>
                {getServiceStatus(selectedService)}
              </Text>
            </div>
            <div>
              <Text strong>Labels:</Text>{' '}
              <Space wrap>
                {Object.entries(selectedService.metadata.labels || {}).map(([key, value]) => (
                  <Text key={key} code style={{ fontSize: '11px' }}>
                    {key}={value}
                  </Text>
                ))}
              </Space>
            </div>
            {selectedService.status?.loadBalancer?.ingress?.[0] && (
              <div>
                <Text strong>External Endpoint:</Text>{' '}
                <Text code>
                  {selectedService.status.loadBalancer.ingress[0].hostname || 
                   selectedService.status.loadBalancer.ingress[0].ip}
                </Text>
              </div>
            )}
          </Space>
        </Card>
      )}
    </div>
  );
};

export default TestPanel;
