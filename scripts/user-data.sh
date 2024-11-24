#!/bin/bash

# Update system
yum update -y

# Install nginx
amazon-linux-extras install nginx1 -y

# Install node and npm
curl -sL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs

# Install AWS CLI
yum install -y aws-cli

# Start and enable nginx
systemctl start nginx
systemctl enable nginx

# Create web directory
mkdir -p /var/www/html

# Create nginx configuration
cat > /etc/nginx/conf.d/upload.conf << 'EOL'
server {
    listen 80;
    server_name _;

    root /var/www/html;
    index index.html;

    client_max_body_size 10M;

    location / {
        try_files $uri $uri/ =404;
    }

    location /upload {
        client_max_body_size 10M;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOL

# Create frontend HTML
cat > /var/www/html/index.html << 'EOL'
<!DOCTYPE html>
<html>
<head>
    <title>File Upload</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .upload-form {
            border: 2px dashed #ccc;
            padding: 20px;
            text-align: center;
            margin-top: 50px;
        }
        .upload-button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
        }
        .upload-button:hover {
            background-color: #45a049;
        }
        #status {
            margin-top: 20px;
            padding: 10px;
            display: none;
        }
        .error {
            background-color: #ffebee;
            color: #c62828;
        }
        .success {
            background-color: #e8f5e9;
            color: #2e7d32;
        }
    </style>
</head>
<body>
    <div class="upload-form">
        <h2>File Upload</h2>
        <p>Allowed extensions: .pdf, .jpg, .png</p>
        <form id="uploadForm" enctype="multipart/form-data">
            <input type="file" id="fileInput" name="file" accept=".pdf,.jpg,.png" />
            <br>
            <button type="submit" class="upload-button">Upload</button>
        </form>
        <div id="status"></div>
    </div>

    <script>
        document.getElementById('uploadForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const statusDiv = document.getElementById('status');
            const fileInput = document.getElementById('fileInput');
            const file = fileInput.files[0];
            
            if (!file) {
                showStatus('Please select a file', 'error');
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                
                if (response.ok) {
                    showStatus('File uploaded successfully!', 'success');
                    fileInput.value = ''; // Clear the file input
                } else {
                    showStatus(`Upload failed: ${result.message}`, 'error');
                }
            } catch (error) {
                showStatus(`Upload failed: ${error.message}`, 'error');
            }
        });

        function showStatus(message, type) {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = message;
            statusDiv.className = type;
            statusDiv.style.display = 'block';
            
            if (type === 'success') {
                setTimeout(() => {
                    statusDiv.style.display = 'none';
                }, 3000);
            }
        }
    </script>
</body>
</html>
EOL

# Create upload server directory
mkdir -p /opt/upload-server

# Create server application
cat > /opt/upload-server/server.js << 'EOL'
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Configure multer for file upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

const s3Client = new S3Client({ region: 'eu-central-1' });
const dynamoClient = new DynamoDBClient({ region: 'eu-central-1' });

const BUCKET_NAME = process.env.BUCKET_NAME;
const TABLE_NAME = process.env.TABLE_NAME;
const ALLOWED_EXTENSIONS = process.env.ALLOWED_EXTENSIONS.split(',');

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
});

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file provided' });
        }

        console.log('Received file:', req.file);
        const fileExtension = path.extname(req.file.originalname).toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
            return res.status(400).json({
                message: `File type not allowed. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`
            });
        }

        // Upload to S3
        const s3Params = {
            Bucket: BUCKET_NAME,
            Key: `${Date.now()}-${req.file.originalname}`,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        };

        console.log('Uploading to S3 with params:', {
            Bucket: s3Params.Bucket,
            Key: s3Params.Key,
            ContentType: s3Params.ContentType
        });

        await s3Client.send(new PutObjectCommand(s3Params));

        // Store metadata in DynamoDB
        const timestamp = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + (30 * 60); // 30 minutes from now

        const dynamoParams = {
            TableName: TABLE_NAME,
            Item: {
                id: { S: `${Date.now()}` },
                uploadDate: { S: timestamp },
                fileExtension: { S: fileExtension },
                fileName: { S: req.file.originalname },
                fileSize: { N: req.file.size.toString() },
                expirationTime: { N: ttl.toString() }
            }
        };

        console.log('Storing in DynamoDB:', dynamoParams);

        await dynamoClient.send(new PutItemCommand(dynamoParams));

        res.json({
            message: 'File uploaded successfully',
            filename: req.file.originalname
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            message: 'Upload failed',
            error: error.message
        });
    }
});

app.listen(port, () => {
    console.log(`Upload server running on port ${port}`);
});
EOL

# Install server dependencies
cd /opt/upload-server
npm init -y
npm install express multer @aws-sdk/client-s3 @aws-sdk/client-dynamodb cors

# Create systemd service for upload server
cat > /etc/systemd/system/upload-server.service << 'EOL'
[Unit]
Description=File Upload Server
After=network.target

[Service]
Environment=NODE_ENV=production
Type=simple
User=ec2-user
WorkingDirectory=/opt/upload-server
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOL

# Set correct permissions
chown -R ec2-user:ec2-user /opt/upload-server

# Start upload server
systemctl enable upload-server
systemctl start upload-server

# Restart nginx to apply new configuration
systemctl restart nginx