# Use official lightweight Node.js Alpine image
FROM node:18-alpine

# Set working directory inside container
WORKDIR /app

# Copy package.json
COPY package*.json ./

# Copy application source code
COPY . .

# Expose default application port
EXPOSE 8080

# Environment variables (can be overridden at runtime via docker run -e)
ENV PORT=8080
ENV API_BASE=http://20.119.77.54:9000

# Start server
CMD ["npm", "start"]
