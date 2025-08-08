#!/bin/bash

# Model Deployment UI 快速安装脚本

echo "🔧 Model Deployment Management Dashboard - Quick Install"
echo "========================================================"

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "📥 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 检查npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not available after Node.js installation"
    exit 1
fi

echo "✅ Node.js $(node -v) and npm $(npm -v) are ready"

# 安装项目依赖
echo "📦 Installing project dependencies..."
npm install

echo "📦 Installing client dependencies..."
cd client && npm install && cd ..

echo "🎉 Installation completed successfully!"
echo ""
echo "🚀 To start the application, run:"
echo "   ./start.sh"
echo ""
echo "📊 The dashboard will be available at: http://localhost:3000"
