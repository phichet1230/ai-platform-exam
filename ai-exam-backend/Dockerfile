# 🌟 สำหรับ Deployment Requirement: Container (Docker) (6 คะแนน)
FROM python:3.10-slim

# ตั้งค่า Directory ทำงาน
WORKDIR /app

# คัดลอกไฟล์ requirements.txt
COPY requirements.txt .

# ติดตั้งไลบรารี
RUN pip install --no-cache-dir -r requirements.txt

# คัดลอกโค้ดทั้งหมดในโฟลเดอร์ Backend ไปที่ /app
COPY . .

# เปิด Port 8000 
EXPOSE 8000

# รัน FastAPI ด้วย Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]