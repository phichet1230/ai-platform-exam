import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
import google.generativeai as genai
from pydantic import BaseModel
from dotenv import load_dotenv
from datetime import datetime
import requests # 👈 ใช้สำหรับดึงข้อความจากไฟล์ให้ AI อ่าน

# 1. โหลดค่า API Keys จากไฟล์ .env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# 2. ตั้งค่า Supabase และ Gemini
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
genai.configure(api_key=GEMINI_API_KEY)

# 🌟 เพิ่มระบบ "ค้นหาโมเดลอัตโนมัติ" (แก้ Error 404 เด็ดขาด)
print("🤖 กำลังค้นหาโมเดล AI ที่ API Key ของคุณรองรับ...")
selected_model_name = "gemini-1.5-flash" # ค่าเริ่มต้นเผื่อค้นหาไม่เจอ
try:
    # ดึงรายชื่อโมเดลทั้งหมดที่กุญแจนี้มีสิทธิ์ใช้
    available_models = [m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods]
    if available_models:
        selected_model_name = available_models[0] # หยิบตัวแรกที่ใช้งานได้มาใช้เลย!
        print(f"✅ พบโมเดลที่ใช้งานได้และระบบเลือกใช้: {selected_model_name}")
    else:
        print("❌ กุญแจ API นี้ไม่พบโมเดลที่รองรับการแชทเลย (อาจต้องสร้างกุญแจใหม่)")
except Exception as e:
    print(f"⚠️ ตรวจสอบโมเดลอัตโนมัติล้มเหลว: {e}")

# ตั้งค่าโมเดลที่ระบบหาเจอ
model = genai.GenerativeModel(selected_model_name)

# 3. สร้างแอป FastAPI
app = FastAPI(title="AI Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- รูปแบบข้อมูลที่รับจากหน้าเว็บ ---
class ChatRequest(BaseModel):
    user_id: str = None  # รองรับ user_id ที่ส่งมาจากหน้าเว็บ
    message: str
    file_url: str = None

# --- API เช็คสถานะ ---
@app.get("/")
def read_root():
    return {"status": "Backend is running! 🚀"}

# --- API อัปโหลดไฟล์ ---
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        file_ext = file.filename.split('.')[-1]
        unique_filename = f"upload_{datetime.now().strftime('%Y%m%d%H%M%S')}.{file_ext}"
        
        file_bytes = await file.read()
        
        # 🌟 บังคับให้ไฟล์ .txt รองรับภาษาไทย (UTF-8) ป้องกันตัวหนังสือเพี้ยน 🌟
        content_type = file.content_type
        if file.filename.lower().endswith('.txt'):
            content_type = "text/plain; charset=utf-8"
            
        supabase.storage.from_("user-files").upload(
            path=unique_filename,
            file=file_bytes,
            file_options={"content-type": content_type} # 👈 ใช้ content_type ที่ตั้งค่าใหม่
        )
        
        file_url = supabase.storage.from_("user-files").get_public_url(unique_filename)
        
        # ลองบันทึก Log ถ้าตารางไม่มีก็ไม่เป็นไร ให้ผ่านไปเลย
        try:
            supabase.table("system_logs").insert({
                "log_type": "event",
                "action": "upload_file",
                "details": {"file_name": file.filename}
            }).execute()
        except Exception as e:
            pass

        return {"status": "success", "file_url": file_url}

    except Exception as e:
        print(f"❌ Upload Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# --- API คุยกับ LLM ---
@app.post("/chat")
async def chat_with_ai(request: ChatRequest):
    try:
        prompt = request.message
        
        if request.file_url:
            # 👈 เปลี่ยนวิธีส่งไฟล์ ให้ Backend ดึงเนื้อหาข้อความมาให้ AI อ่านตรงๆ
            try:
                file_response = requests.get(request.file_url)
                file_response.encoding = 'utf-8' # ป้องกันภาษาไทยเพี้ยนตอน AI อ่าน
                file_content = file_response.text
                prompt = f"นี่คือเนื้อหาจากไฟล์ที่แนบมา:\n\n---\n{file_content}\n---\n\nจากข้อมูลด้านบน คำถาม: {request.message}"
            except Exception as e:
                print(f"⚠️ อ่านไฟล์ไม่สำเร็จ: {e}")
                prompt = f"ดูข้อมูลจากไฟล์นี้ (URL: {request.file_url})\n\nคำถาม: {request.message}"

        # ส่งไปให้ Gemini ด้วยโมเดลที่ถูกเลือก
        response = model.generate_content(prompt)
        ai_reply = response.text
        
        tokens_used = 0
        if hasattr(response, 'usage_metadata'):
             tokens_used = response.usage_metadata.total_token_count
             
        # ลองบันทึก Log ถ้าตารางไม่มีก็ไม่เป็นไร ให้ผ่านไปเลย
        try:
            supabase.table("system_logs").insert({
                "log_type": "llm_usage",
                "action": "call_llm",
                "details": {"prompt": request.message, "tokens": tokens_used}
            }).execute()
        except Exception as e:
            pass

        return {
            "status": "success",
            "reply": ai_reply,
            "tokens_used": tokens_used,
            "citation": f"Google Gemini ({selected_model_name})" # โชว์เลยว่าใช้โมเดลชื่ออะไรตอบ
        }

    except Exception as e:
        print(f"❌ AI Chat Error: {str(e)}") # พิมพ์ Error จริงๆ ออกมาดูใน Terminal
        raise HTTPException(status_code=500, detail=f"AI Error: {str(e)}")