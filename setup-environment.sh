#!/bin/bash

# 新环境部署脚本
# 用于在新环境中从Git拉取代码后的初始化设置

echo "🚀 Model Deployment UI - Environment Setup"
echo "=========================================="

# 检查当前目录
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script in the project root directory."
    exit 1
fi

echo ""
echo "1️⃣ Environment Check:"
echo "---------------------"

# 检查Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "✅ Node.js: $NODE_VERSION"
    
    # 检查版本是否满足要求
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -lt 16 ]; then
        echo "⚠️  Warning: Node.js version should be 16 or higher"
        echo "   Current: $NODE_VERSION"
        echo "   Please upgrade Node.js: https://nodejs.org/"
    fi
else
    echo "❌ Node.js not found. Please install Node.js 16+ first."
    echo "   Download from: https://nodejs.org/"
    exit 1
fi

# 检查npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo "✅ npm: v$NPM_VERSION"
else
    echo "❌ npm not found. Please install npm."
    exit 1
fi

# 检查kubectl
if command -v kubectl &> /dev/null; then
    echo "✅ kubectl: $(kubectl version --client --short 2>/dev/null | cut -d' ' -f3)"
else
    echo "⚠️  kubectl not found. Install it if you plan to deploy to Kubernetes."
    echo "   Installation guide: https://kubernetes.io/docs/tasks/tools/"
fi

echo ""
echo "2️⃣ Installing Dependencies:"
echo "---------------------------"

# 安装后端依赖
echo "📦 Installing backend dependencies..."
if npm install; then
    echo "✅ Backend dependencies installed successfully"
else
    echo "❌ Failed to install backend dependencies"
    exit 1
fi

# 安装前端依赖
echo ""
echo "📦 Installing frontend dependencies..."
cd client
if npm install; then
    echo "✅ Frontend dependencies installed successfully"
    cd ..
else
    echo "❌ Failed to install frontend dependencies"
    exit 1
fi

echo ""
echo "3️⃣ Verifying Installation:"
echo "--------------------------"

# 检查关键依赖
echo "🔍 Checking key dependencies..."

# 后端依赖检查
BACKEND_DEPS=("express" "ws" "cors" "fs-extra" "yaml")
for dep in "${BACKEND_DEPS[@]}"; do
    if [ -d "node_modules/$dep" ]; then
        echo "✅ Backend: $dep"
    else
        echo "❌ Backend: $dep missing"
    fi
done

# 前端依赖检查
FRONTEND_DEPS=("react" "antd" "react-scripts")
for dep in "${FRONTEND_DEPS[@]}"; do
    if [ -d "client/node_modules/$dep" ]; then
        echo "✅ Frontend: $dep"
    else
        echo "❌ Frontend: $dep missing"
    fi
done

echo ""
echo "4️⃣ Creating Required Directories:"
echo "---------------------------------"

# 创建必要的目录
mkdir -p logs
mkdir -p tmp
echo "✅ Created logs/ and tmp/ directories"

echo ""
echo "5️⃣ Setting Script Permissions:"
echo "------------------------------"

# 给所有shell脚本添加执行权限
find . -name "*.sh" -type f -exec chmod +x {} \;
echo "✅ Set execute permissions for all .sh files"

echo ""
echo "6️⃣ Environment Configuration:"
echo "-----------------------------"

# 检查是否需要环境变量配置
if [ ! -f ".env" ]; then
    echo "📝 Creating sample .env file..."
    cat > .env << EOF
# Model Deployment UI Environment Configuration
# Copy this file and modify as needed

# Server Configuration
PORT=3001
WS_PORT=8081

# Kubernetes Configuration (optional)
# KUBECONFIG=/path/to/your/kubeconfig

# AWS Configuration (optional)
# AWS_REGION=us-west-2
# AWS_PROFILE=default

# Development Mode
NODE_ENV=development
EOF
    echo "✅ Created sample .env file"
    echo "   Please review and modify .env as needed"
else
    echo "✅ .env file already exists"
fi

echo ""
echo "7️⃣ Testing Installation:"
echo "------------------------"

# 快速测试
echo "🧪 Running quick tests..."

# 测试后端依赖
if node -e "require('express'); console.log('Backend dependencies OK')" 2>/dev/null; then
    echo "✅ Backend dependencies test passed"
else
    echo "❌ Backend dependencies test failed"
fi

# 测试前端依赖
if cd client && node -e "require('react'); console.log('Frontend dependencies OK')" 2>/dev/null; then
    echo "✅ Frontend dependencies test passed"
    cd ..
else
    echo "❌ Frontend dependencies test failed"
fi

echo ""
echo "8️⃣ Final Setup Summary:"
echo "-----------------------"

echo "📊 Installation Summary:"
echo "  • Backend dependencies: $(ls node_modules | wc -l) packages"
echo "  • Frontend dependencies: $(ls client/node_modules | wc -l) packages"
echo "  • Total disk usage: $(du -sh . | cut -f1)"

echo ""
echo "🎯 Next Steps:"
echo "1. Review and configure .env file if needed"
echo "2. Ensure kubectl is configured for your cluster:"
echo "   kubectl cluster-info"
echo "3. Start the application:"
echo "   ./start.sh"
echo "4. Access the UI at: http://localhost:3000"

echo ""
echo "📚 Available Scripts:"
echo "  ./start.sh                    - Start the application"
echo "  ./test-features.sh           - Run feature tests"
echo "  ./verify-data.sh             - Verify data connectivity"
echo "  ./analyze-project-structure.sh - Analyze project structure"

echo ""
echo "🔧 Troubleshooting:"
echo "  • If kubectl commands fail, configure your kubeconfig"
echo "  • If ports are in use, modify PORT/WS_PORT in .env"
echo "  • Check logs/ directory for error logs"
echo "  • Run individual test scripts to diagnose issues"

echo ""
echo "✅ Environment setup completed successfully!"
echo "🚀 Ready to run: ./start.sh"
