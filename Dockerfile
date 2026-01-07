# Use valid Playwright image that includes browser binaries
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including production deps)
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
