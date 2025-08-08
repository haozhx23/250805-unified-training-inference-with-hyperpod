import React, { useEffect, useState } from 'react';
import { 
  Table, 
  Progress, 
  Tag, 
  Button, 
  Space,
  Statistic,
  Row,
  Col,
  Card,
  message
} from 'antd';
import { 
  ReloadOutlined, 
  CheckCircleOutlined, 
  ExclamationCircleOutlined,
  ClusterOutlined
} from '@ant-design/icons';

const ClusterStatus = ({ clusterData, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // 自动刷新功能
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('Auto-refreshing cluster status...');
      handleRefresh();
    }, 60000); // 每60秒（1分钟）自动刷新

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await onRefresh();
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error refreshing cluster status:', error);
      message.error('Failed to refresh cluster status');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: 'Node Name',
      dataIndex: 'nodeName',
      key: 'nodeName',
      render: (text) => (
        <Space>
          <ClusterOutlined />
          <span style={{ fontFamily: 'monospace' }}>{text}</span>
        </Space>
      ),
    },
    {
      title: 'GPU Usage',
      key: 'gpuUsage',
      render: (_, record) => {
        const { totalGPU, usedGPU, availableGPU } = record;
        const percentage = totalGPU > 0 ? (usedGPU / totalGPU) * 100 : 0;
        
        return (
          <div>
            <Progress 
              percent={percentage} 
              size="small"
              status={percentage > 80 ? 'exception' : 'active'}
              format={() => `${usedGPU}/${totalGPU}`}
            />
            <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
              Available: {availableGPU} GPUs
            </div>
          </div>
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => {
        const { totalGPU, availableGPU, error } = record;
        
        if (error) {
          return (
            <Tag color="red" icon={<ExclamationCircleOutlined />}>
              Error
            </Tag>
          );
        }
        
        if (availableGPU === 0 && totalGPU > 0) {
          return (
            <Tag color="orange" icon={<ExclamationCircleOutlined />}>
              Full
            </Tag>
          );
        }
        
        return (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            Available
          </Tag>
        );
      },
    },
  ];

  // 计算总体统计
  const totalStats = clusterData.reduce(
    (acc, node) => ({
      totalNodes: acc.totalNodes + 1,
      totalGPUs: acc.totalGPUs + node.totalGPU,
      usedGPUs: acc.usedGPUs + node.usedGPU,
      availableGPUs: acc.availableGPUs + node.availableGPU,
    }),
    { totalNodes: 0, totalGPUs: 0, usedGPUs: 0, availableGPUs: 0 }
  );

  return (
    <div>
      {/* 总体统计 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Nodes"
              value={totalStats.totalNodes}
              prefix={<ClusterOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Total GPUs"
              value={totalStats.totalGPUs}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Used GPUs"
              value={totalStats.usedGPUs}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="Available"
              value={totalStats.availableGPUs}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 刷新按钮和状态 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '12px', color: '#666' }}>
          {lastUpdate && `Last updated: ${lastUpdate.toLocaleTimeString()}`}
          <span style={{ marginLeft: 8, color: '#52c41a' }}>
            • Auto-refresh every 1 min
          </span>
        </div>
        <Button 
          icon={<ReloadOutlined />} 
          onClick={handleRefresh}
          loading={loading}
          size="small"
        >
          Refresh Now
        </Button>
      </div>

      {/* 节点详情表格 */}
      <Table
        columns={columns}
        dataSource={clusterData}
        rowKey="nodeName"
        size="small"
        pagination={false}
        scroll={{ y: 200 }}
        loading={loading}
        locale={{
          emptyText: 'No cluster data available'
        }}
      />
    </div>
  );
};

export default ClusterStatus;
