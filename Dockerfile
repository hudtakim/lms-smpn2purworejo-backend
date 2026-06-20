# Gunakan image node resmi yang ringan
FROM node:20-alpine

# Tentukan working directory di dalam container
WORKDIR /app

# Copy package.json dan package-lock.json terlebih dahulu (optimasi cache layer)
COPY package*.json ./

# Install dependensi produksi
RUN npm install

# Copy seluruh kode backend
COPY . .

# Buat folder uploads secara eksplisit di dalam container
RUN mkdir -p uploads

# Ekspos port backend
EXPOSE 5000

# Jalankan aplikasi
CMD ["node", "index.js"]