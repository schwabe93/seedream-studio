#!/bin/bash

echo "🎨 Seedream Studio Installer for Ubuntu"

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "⚠️  Please do not run as root/sudo"
   exit 1
fi

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18 if not present
if ! command -v node &> /dev/null; then
    echo "📥 Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    echo "📥 Installing PM2..."
    sudo npm install -g pm2
fi

# Create app directory
APP_DIR="$HOME/seedream-studio"
mkdir -p $APP_DIR
cd $APP_DIR

# Create package.json if not exists
if [ ! -f "package.json" ]; then
    echo "📝 Creating project files..."
    # Copy the package.json content here via cat or wget
fi

# Install dependencies
echo "🔧 Installing dependencies..."
npm install

# Create data directories
mkdir -p data/references
mkdir -p data/outputs/images
mkdir -p data/outputs/videos
mkdir -p logs

# Setup PM2
echo "🚀 Starting with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd

echo ""
echo "✅ Installation complete!"
echo "🌐 Access your studio at: http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "Useful commands:"
echo "  pm2 status           - Check status"
echo "  pm2 logs             - View logs"
echo "  pm2 restart all      - Restart app"
echo ""