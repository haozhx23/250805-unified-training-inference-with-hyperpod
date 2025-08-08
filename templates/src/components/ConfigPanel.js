import React, { useState } from 'react';
import { 
  Form, 
  Input, 
  InputNumber, 
  Button, 
  Space, 
  Alert,
  Divider,
  Tooltip,
  Tabs,
  Collapse,
  Typography,
  Checkbox,
  Row,
  Col
} from 'antd';
import { 
  RocketOutlined, 
  InfoCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CodeOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  LinkOutlined,
  GlobalOutlined,
  LockOutlined
} from '@ant-design/icons';

const { TextArea } = Input;
const { TabPane } = Tabs;
const { Panel } = Collapse;
const { Link } = Typography;

const ConfigPanel = ({ onDeploy, deploymentStatus }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('vllm');

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const deploymentConfig = {
        ...values,
        deploymentType: activeTab
      };
      
      // 如果是VLLM部署，从命令中提取模型ID
      if (activeTab === 'vllm' && values.vllmCommand) {
        const modelId = extractModelIdFromVllmCommand(values.vllmCommand);
        if (modelId) {
          deploymentConfig.modelId = modelId;
        }
      }
      
      await onDeploy(deploymentConfig);
    } finally {
      setLoading(false);
    }
  };

  // 从VLLM命令中提取模型ID
  const extractModelIdFromVllmCommand = (command) => {
    try {
      // 清理命令字符串
      const cleanCommand = command
        .replace(/\\\s*\n/g, ' ')  // 处理反斜杠换行
        .replace(/\s+/g, ' ')      // 合并多个空格
        .trim();
      
      // 分割为数组
      const parts = cleanCommand.split(' ').filter(part => part.trim());
      
      // 查找 --model 参数
      const modelIndex = parts.findIndex(part => part === '--model');
      if (modelIndex !== -1 && modelIndex + 1 < parts.length) {
        return parts[modelIndex + 1];
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting model ID from VLLM command:', error);
      return null;
    }
  };


  const getStatusAlert = () => {
    if (!deploymentStatus) return null;
    
    const { status, message } = deploymentStatus;
    
    return (
      <Alert
        message={message}
        type={status === 'success' ? 'success' : 'error'}
        icon={status === 'success' ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />
    );
  };

  const defaultVllmCommand = `python3 -m vllm.entrypoints.openai.api_server \\
--model Qwen/Qwen3-0.6B \\
--max-num-seqs 32 \\
--max-model-len 1280 \\
--tensor-parallel-size 1 \\
--host 0.0.0.0 \\
--port 8000 \\
--trust-remote-code`;

  const VLLMForm = () => (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      initialValues={{
        replicas: 1,
        vllmCommand: defaultVllmCommand,
        isExternal: true
      }}
    >
      <Form.Item
        label={
          <Space>
            Replicas
            <Tooltip title="Number of model replicas to deploy">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="replicas"
        rules={[
          { required: true, message: 'Please input replicas count!' },
          { type: 'number', min: 1, max: 10, message: 'Replicas must be between 1 and 10' }
        ]}
      >
        <InputNumber 
          min={1} 
          max={10} 
          style={{ width: '100%' }}
          placeholder="Number of replicas"
        />
      </Form.Item>


      {/* 可折叠的高级设置 */}
      <Collapse ghost>
        <Panel 
          header={
            <Space>
              <SettingOutlined />
              Advanced Settings
            </Space>
          } 
          key="advanced"
        >
          <Form.Item
            label={
              <Space>
                Hugging Face Token
                <Tooltip title="Optional: Required for private models">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            }
            name="huggingFaceToken"
          >
            <Input.Password 
              placeholder="hf_xxxxxxxxxx (optional)"
              visibilityToggle
            />
          </Form.Item>
        </Panel>
      </Collapse>

      <Form.Item
        label={
          <Space>
            <CodeOutlined />
            VLLM Command
            <Tooltip title="Complete VLLM command including entrypoint and all parameters">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="vllmCommand"
        rules={[{ required: true, message: 'Please input VLLM command!' }]}
      >
        <TextArea
          rows={8}
          placeholder={defaultVllmCommand}
          style={{ fontFamily: 'monospace', fontSize: '12px' }}
        />
      </Form.Item>

      <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f6f8fa', borderRadius: 6 }}>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: 8 }}>
          <strong>命令格式说明：</strong>
        </div>
        <div style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace' }}>
          • 必须以 python3 -m vllm.entrypoints.openai.api_server 开头<br/>
          • 使用反斜杠 \ 进行换行<br/>
          • 参数格式：--参数名 参数值<br/>
          • 系统会自动解析tensor-parallel-size来配置GPU资源
        </div>
      </div>

      {/* 部署选项 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<RocketOutlined />}
              size="large"
              block
            >
              {loading ? 'Deploying VLLM Model...' : 'Deploy VLLM Model'}
            </Button>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="isExternal"
            valuePropName="checked"
            style={{ marginTop: 8 }}
          >
            <Checkbox>
              <Space>
                <GlobalOutlined />
                <span>External Access</span>
                <Tooltip title="Enable internet-facing LoadBalancer for external access. Uncheck for internal-only access.">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            </Checkbox>
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );

  const OllamaForm = () => (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      initialValues={{
        replicas: 1,
        ollamaModelId: 'gpt-oss:20b',
        gpuCount: 1,
        isExternal: true
      }}
    >
      <Form.Item
        label={
          <Space>
            Replicas
            <Tooltip title="Number of model replicas to deploy">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="replicas"
        rules={[
          { required: true, message: 'Please input replicas count!' },
          { type: 'number', min: 1, max: 10, message: 'Replicas must be between 1 and 10' }
        ]}
      >
        <InputNumber 
          min={1} 
          max={10} 
          style={{ width: '100%' }}
          placeholder="Number of replicas"
        />
      </Form.Item>

      <Form.Item
        label={
          <Space>
            Ollama Model ID
            <Tooltip title={
              <div>
                The model ID that Ollama will pull and run.<br/>
                <Link href="https://ollama.com/search" target="_blank" rel="noopener noreferrer">
                  <LinkOutlined /> Browse available models at ollama.com/search
                </Link>
              </div>
            }>
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="ollamaModelId"
        rules={[{ required: true, message: 'Please input Ollama model ID!' }]}
      >
        <Input
          placeholder="e.g., gpt-oss:20b, llama2:7b, mistral"
          style={{ width: '100%' }}
        />
      </Form.Item>

      <Form.Item
        label={
          <Space>
            GPU Count
            <Tooltip title="Number of GPUs allocated per replica">
              <InfoCircleOutlined />
            </Tooltip>
          </Space>
        }
        name="gpuCount"
        rules={[
          { required: true, message: 'Please input GPU count!' },
          { type: 'number', min: 1, max: 8, message: 'GPU count must be between 1 and 8' }
        ]}
      >
        <InputNumber 
          min={1} 
          max={8} 
          style={{ width: '100%' }}
          placeholder="Number of GPUs per replica"
        />
      </Form.Item>

      <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f0f9ff', borderRadius: 6 }}>
        <div style={{ fontSize: '12px', color: '#0369a1', marginBottom: 8 }}>
          <strong>Ollama 部署说明：</strong>
        </div>
        <div style={{ fontSize: '11px', color: '#0c4a6e' }}>
          • Ollama会自动拉取指定的模型<br/>
          • 服务将在端口11434上运行<br/>
          • 支持标准的Ollama API格式<br/>
          • 模型会缓存在持久存储中<br/>
          • 部署名称将基于模型ID自动生成
        </div>
      </div>

      {/* 部署选项 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<ThunderboltOutlined />}
              size="large"
              block
              style={{ backgroundColor: '#059669', borderColor: '#059669' }}
            >
              {loading ? 'Deploying Ollama Model...' : 'Deploy Ollama Model'}
            </Button>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="isExternal"
            valuePropName="checked"
            style={{ marginTop: 8 }}
          >
            <Checkbox>
              <Space>
                <GlobalOutlined />
                <span>External Access</span>
                <Tooltip title="Enable internet-facing LoadBalancer for external access. Uncheck for internal-only access.">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            </Checkbox>
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );

  return (
    <div>
      {getStatusAlert()}
      
      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab}
        type="card"
        size="small"
      >
        <TabPane 
          tab={
            <Space>
              <CodeOutlined />
              VLLM
            </Space>
          } 
          key="vllm"
        >
          <VLLMForm />
        </TabPane>
        
        <TabPane 
          tab={
            <Space>
              <ThunderboltOutlined />
              Ollama
            </Space>
          } 
          key="ollama"
        >
          <OllamaForm />
        </TabPane>
      </Tabs>

      <div style={{ marginTop: 16, fontSize: '12px', color: '#666' }}>
        <strong>Note:</strong> 系统会根据选择的部署类型和访问模式生成相应的Kubernetes配置。
        确保EKS集群有足够的GPU资源。
      </div>
    </div>
  );
};

export default ConfigPanel;
