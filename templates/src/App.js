import React, { useState, useEffect } from 'react';
import { Layout, Row, Col, Card, message, Tabs } from 'antd';
import ConfigPanel from './components/ConfigPanel';
import ClusterStatus from './components/ClusterStatus';
import TestPanel from './components/TestPanel';
import StatusMonitor from './components/StatusMonitor';
import DeploymentManager from './components/DeploymentManager';
import { CONFIG } from './config/constants';
import './App.css';

const { Header, Content } = Layout;
const { TabPane } = Tabs;

function App() {
  const [clusterData, setClusterData] = useState([]);
  const [pods, setPods] = useState([]);
  const [services, setServices] = useState([]);
  const [deploymentStatus, setDeploymentStatus] = useState(null);
  const [ws, setWs] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');

  const connectWebSocket = () => {
    console.log('Attempting to connect to WebSocket...');
    
    const websocket = new WebSocket('ws://localhost:8081');
    
    websocket.onopen = () => {
      console.log('WebSocket connected successfully');
      setWs(websocket);
      setConnectionStatus('connected');
    };
    
    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data.type);
        
        switch (data.type) {
          case 'status_update':
            console.log('Status update:', data.pods?.length, 'pods,', data.services?.length, 'services');
            setPods(data.pods || []);
            setServices(data.services || []);
            break;
          case 'deployment':
            setDeploymentStatus(data);
            if (data.status === 'success') {
              message.success(data.message);
            } else {
              message.error(data.message);
            }
            break;
          case 'undeployment':
            if (data.status === 'success') {
              message.success(data.message);
            } else {
              message.error(data.message);
            }
            break;
          default:
            console.log('Unknown message type:', data.type);
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    websocket.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      setWs(null);
      setConnectionStatus('disconnected');
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('error');
    };
    
    return websocket;
  };

  useEffect(() => {
    // 延迟连接WebSocket，给后端服务器启动时间
    const connectTimer = setTimeout(() => {
      connectWebSocket();
    }, 1000); // 延迟1秒连接
    
    // 初始加载集群状态
    fetchClusterStatus();
    
    // 初始加载pods和services（作为备用）
    fetchPodsAndServices();
    
    return () => {
      clearTimeout(connectTimer);
      if (ws) {
        ws.close(1000, 'Component unmounting'); // 正常关闭
      }
    };
  }, []);

  const fetchClusterStatus = async () => {
    try {
      console.log('Fetching cluster status...');
      const response = await fetch('/api/cluster-status');
      const data = await response.json();
      console.log('Cluster status response:', data);
      setClusterData(data.nodes || []);
    } catch (error) {
      console.error('Error fetching cluster status:', error);
      message.error('Failed to fetch cluster status');
    }
  };

  const fetchPodsAndServices = async () => {
    try {
      console.log('Fetching pods and services...');
      const [podsResponse, servicesResponse] = await Promise.all([
        fetch('/api/pods'),
        fetch('/api/services')
      ]);
      
      const podsData = await podsResponse.json();
      const servicesData = await servicesResponse.json();
      
      console.log('Pods response:', podsData.length, 'pods');
      console.log('Services response:', servicesData.length, 'services');
      
      setPods(podsData);
      setServices(servicesData);
    } catch (error) {
      console.error('Error fetching pods and services:', error);
      message.error('Failed to fetch pods and services');
    }
  };

  const handleDeploy = async (config) => {
    try {
      console.log('Deploying with config:', config);
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      
      const result = await response.json();
      
      if (result.success) {
        message.success('Deployment initiated successfully');
        // 刷新集群状态
        fetchClusterStatus();
        // 刷新pods和services
        fetchPodsAndServices();
      } else {
        message.error(`Deployment failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Error deploying:', error);
      message.error('Failed to deploy model');
    }
  };

  const getConnectionStatusDisplay = () => {
    switch (connectionStatus) {
      case 'connected':
        return '🟢 Real-time Updates';
      case 'connecting':
        return '🟡 Connecting...';
      case 'disconnected':
        return '🟠 Offline (Refresh to reconnect)';
      case 'error':
        return '🔴 Connection Error';
      default:
        return '🔴 Unknown';
    }
  };

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <h1 style={{ color: 'white', margin: 0 }}>
          InstantStart Model Deployment on HyperPod
        </h1>
        <div style={{ marginLeft: 'auto', color: 'white', fontSize: '12px' }}>
          Status: {getConnectionStatusDisplay()}
        </div>
      </Header>
      
      <Content className="app-content">
        <Row gutter={[16, 16]} style={{ height: '100%' }}>
          {/* 左上：配置面板 */}
          <Col xs={24} lg={12}>
            <Card 
              title="Model Configuration" 
              className="config-card"
              style={{ height: '50vh', overflow: 'auto' }}
            >
              <ConfigPanel 
                onDeploy={handleDeploy}
                deploymentStatus={deploymentStatus}
              />
            </Card>
          </Col>
          
          {/* 右上：测试面板 */}
          <Col xs={24} lg={12}>
            <Card 
              title="Model Testing"
              className="test-card"
              style={{ height: '50vh', overflow: 'auto' }}
            >
              <TestPanel services={services} />
            </Card>
          </Col>
          
          {/* 左下：集群状态 */}
          <Col xs={24} lg={12}>
            <Card 
              title="Cluster Status" 
              className="cluster-card"
              style={{ height: '45vh', overflow: 'auto' }}
            >
              <ClusterStatus 
                clusterData={clusterData}
                onRefresh={fetchClusterStatus}
              />
            </Card>
          </Col>
          
          {/* 右下：状态监控和部署管理 */}
          <Col xs={24} lg={12}>
            <Card 
              className="monitor-card"
              style={{ height: '45vh', overflow: 'auto' }}
              bodyStyle={{ padding: 0 }}
            >
              <Tabs defaultActiveKey="monitor" size="small">
                <TabPane 
                  tab="Monitor" 
                  key="monitor"
                >
                  <div style={{ padding: '16px' }}>
                    <StatusMonitor 
                      pods={pods}
                      services={services}
                      onRefresh={fetchPodsAndServices}
                    />
                  </div>
                </TabPane>
                <TabPane 
                  tab="Deployments" 
                  key="deployments"
                >
                  <div style={{ padding: '16px' }}>
                    <DeploymentManager />
                  </div>
                </TabPane>
              </Tabs>
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}

export default App;
