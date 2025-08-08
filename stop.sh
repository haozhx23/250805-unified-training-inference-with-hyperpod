#!/bin/bash

# Model Deployment UI 停止脚本

echo "🛑 Stopping Model Deployment UI services..."

# 终止相关进程
echo "📋 Terminating Node.js processes..."
pkill -f "node server/index.js" 2>/dev/null && echo "  ✅ Backend server stopped"
pkill -f "react-scripts start" 2>/dev/null && echo "  ✅ Frontend server stopped"
pkill -f "concurrently" 2>/dev/null && echo "  ✅ Concurrently process stopped"
pkill -f "nodemon server/index.js" 2>/dev/null && echo "  ✅ Nodemon process stopped"

# 等待进程完全退出
echo "⏳ Waiting for processes to exit..."
sleep 3

# 检查并强制清理端口
echo "🔧 Checking and cleaning up ports..."
PORTS_CLEANED=0

for port in 3000 3001 8081; do
    if lsof -ti :$port >/dev/null 2>&1; then
        echo "  🔧 Force killing processes on port $port"
        lsof -ti :$port | xargs kill -9 2>/dev/null
        PORTS_CLEANED=$((PORTS_CLEANED + 1))
        sleep 1
    fi
done

if [ $PORTS_CLEANED -gt 0 ]; then
    echo "  ⚠️  $PORTS_CLEANED ports were force-cleaned"
else
    echo "  ✅ All ports were already free"
fi

# 最终验证
echo "🔍 Final verification..."
REMAINING_PROCESSES=0

# 检查是否还有相关进程
if pgrep -f "node server/index.js" >/dev/null 2>&1; then
    echo "  ⚠️  Backend server process still running"
    REMAINING_PROCESSES=$((REMAINING_PROCESSES + 1))
fi

if pgrep -f "react-scripts start" >/dev/null 2>&1; then
    echo "  ⚠️  Frontend server process still running"
    REMAINING_PROCESSES=$((REMAINING_PROCESSES + 1))
fi

# 检查端口占用
for port in 3000 3001 8081; do
    if lsof -ti :$port >/dev/null 2>&1; then
        echo "  ⚠️  Port $port is still occupied"
        REMAINING_PROCESSES=$((REMAINING_PROCESSES + 1))
    fi
done

if [ $REMAINING_PROCESSES -eq 0 ]; then
    echo "✅ All Model Deployment UI services stopped successfully"
    echo ""
    echo "📊 Status:"
    echo "  • Frontend (port 3000): ✅ Stopped"
    echo "  • Backend API (port 3001): ✅ Stopped"
    echo "  • WebSocket (port 8081): ✅ Stopped"
else
    echo "⚠️  Some processes or ports may still be in use"
    echo "   You may need to manually check and clean up"
    echo ""
    echo "🔧 Manual cleanup commands:"
    echo "   ps aux | grep node                    # Check remaining processes"
    echo "   ss -tlnp | grep -E ':(3000|3001|8081)' # Check port usage"
    echo "   sudo lsof -ti :PORT | xargs kill -9   # Force kill by port"
fi

echo ""
echo "🚀 To restart the services, run: ./start.sh"
