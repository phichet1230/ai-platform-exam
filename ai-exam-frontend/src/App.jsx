import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import axios from 'axios';

// 1. ตั้งค่าการเชื่อมต่อ Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ตรวจสอบว่าใส่ .env ครบหรือไม่
const isEnvMissing = !supabaseUrl || !supabaseKey;
const supabase = !isEnvMissing ? createClient(supabaseUrl, supabaseKey) : null;

// URL ของ Backend
const BACKEND_URL = 'http://127.0.0.1:8000';

export default function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (isEnvMissing) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (isEnvMissing) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-red-50 p-6 text-gray-800">
        <div className="max-w-xl rounded-lg bg-white p-8 shadow-lg border-l-4 border-red-500">
          <h1 className="text-2xl font-bold text-red-600 mb-4">🚨 ข้อผิดพลาด: ไม่พบการตั้งค่า Environment Variables</h1>
          <p>กรุณาตรวจสอบไฟล์ .env</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthForm />;
  }

  return <Dashboard session={session} />;
}

// --- หน้าจอ Login / Register ---
function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert('สมัครสมาชิกสำเร็จ! กรุณาล็อกอิน');
        setIsLogin(true);
      }
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-100 text-gray-900">
      <div className="w-96 rounded-lg bg-white p-8 shadow-md">
        <h2 className="mb-6 text-2xl font-bold text-center text-gray-800">
          {isLogin ? 'เข้าสู่ระบบ AI Platform' : 'สมัครสมาชิก'}
        </h2>
        <form onSubmit={handleAuth} className="space-y-4">
          <input
            type="email"
            placeholder="อีเมล"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 text-gray-900 bg-white focus:border-blue-500 focus:outline-none"
            required
          />
          <input
            type="password"
            placeholder="รหัสผ่าน"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 text-gray-900 bg-white focus:border-blue-500 focus:outline-none"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-600 p-2 text-white font-bold hover:bg-blue-700 disabled:bg-blue-300"
          >
            {loading ? 'กำลังโหลด...' : (isLogin ? 'ล็อกอิน' : 'ลงทะเบียน')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          {isLogin ? 'ยังไม่มีบัญชี?' : 'มีบัญชีอยู่แล้ว?'}
          <button onClick={() => setIsLogin(!isLogin)} className="ml-1 text-blue-600 hover:underline">
            {isLogin ? 'สมัครเลย' : 'ล็อกอิน'}
          </button>
        </p>
      </div>
    </div>
  );
}

// --- หน้าจอ Dashboard หลัก ---
function Dashboard({ session }) {
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [selectedFileUrl, setSelectedFileUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ดึงรายการไฟล์จาก Supabase โดยใช้ถังชื่อ 'user-files'
  const fetchFiles = async () => {
    const { data, error } = await supabase.storage.from('user-files').list();
    if (data) {
      // กรองเอาเฉพาะไฟล์ ไม่เอาโฟลเดอร์เปล่าที่ supabase อาจจะสร้างไว้
      const validFiles = data.filter(file => file.name !== '.emptyFolderPlaceholder');
      setFiles(validFiles);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // ฟังก์ชันอัปโหลดที่แก้ใหม่ อัปโหลดตรงเข้า Supabase 'user-files' เลย
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // เปลี่ยนชื่อไฟล์นิดหน่อยเผื่อซ้ำ หรือจะใช้ file.name เลยก็ได้
      const filePath = `${file.name}`;
      
      const { data, error } = await supabase.storage
        .from('user-files')
        .upload(filePath, file, {
          upsert: true // เปิดให้เขียนทับไฟล์เดิมได้ถ้าชื่อซ้ำ จะได้ไม่พัง
        });

      if (error) throw error;

      alert('อัปโหลดไฟล์สำเร็จ!');
      fetchFiles(); // โหลดรายการไฟล์ใหม่
    } catch (error) {
      alert('เกิดข้อผิดพลาดในการอัปโหลด: ' + error.message);
    } finally {
      setIsUploading(false);
      // เคลียร์ค่า input file เผื่ออัปโหลดไฟล์ชื่อเดิมซ้ำ
      e.target.value = null; 
    }
  };

  // ฟังก์ชันลบไฟล์
  const handleDeleteFile = async (fileName) => {
    const confirmDelete = window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบไฟล์ "${fileName}" ?\n(ลบแล้วไม่สามารถกู้คืนได้)`);
    if (!confirmDelete) return;

    try {
      const { error } = await supabase.storage.from('user-files').remove([fileName]);
      if (error) throw error;

      const deletingFileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${fileName}`;
      if (selectedFileUrl === deletingFileUrl) {
        setSelectedFileUrl('');
      }

      fetchFiles();
    } catch (error) {
      alert('เกิดข้อผิดพลาดในการลบไฟล์: ' + error.message);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() && !selectedFileUrl) return;

    const newMessage = { role: 'user', content: input, fileUrl: selectedFileUrl };
    setMessages(prev => [...prev, newMessage]);
    setInput('');
    setLoadingChat(true);

    try {
      const res = await axios.post(`${BACKEND_URL}/chat`, {
        user_id: session.user.id,
        message: newMessage.content,
        file_url: newMessage.fileUrl
      });

      const aiReply = { 
        role: 'ai', 
        content: res.data.reply, 
        tokens: res.data.tokens,
        citation: res.data.citation
      };
      setMessages(prev => [...prev, aiReply]);
      setSelectedFileUrl(''); 
    } catch (error) {
      setMessages(prev => [...prev, { role: 'ai', content: '❌ ขออภัย เกิดข้อผิดพลาดในการเชื่อมต่อ AI: ' + error.message }]);
    } finally {
      setLoadingChat(false);
    }
  };

  const handleViewFile = async (e, fileUrl, fileName) => {
    e.preventDefault();
    if (fileName.toLowerCase().endsWith('.txt')) {
      try {
        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(buffer);
        
        const newWindow = window.open('', '_blank');
        newWindow.document.write(`
          <!DOCTYPE html>
          <html lang="th">
            <head>
              <meta charset="UTF-8">
              <title>${fileName}</title>
              <style>
                body { font-family: sans-serif; padding: 20px; white-space: pre-wrap; line-height: 1.6; color: #333; }
              </style>
            </head>
            <body>${text}</body>
          </html>
        `);
        newWindow.document.close();
      } catch (error) {
        window.open(fileUrl, '_blank'); 
      }
    } else {
      window.open(fileUrl, '_blank');
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-50 text-gray-900">
      
      {/* --- แถบด้านซ้าย (File Management) --- */}
      <div className="w-72 bg-white border-r border-gray-200 p-4 flex flex-col">
        <h2 className="text-lg font-bold text-gray-800 mb-4">📂 ไฟล์ของฉัน</h2>
        
        <label className={`p-2 rounded cursor-pointer text-center transition font-medium border-2 border-dashed ${isUploading ? 'bg-gray-100 text-gray-500 border-gray-300' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200'}`}>
          {isUploading ? '⏳ กำลังอัปโหลด...' : '+ อัปโหลดไฟล์ใหม่'}
          <input type="file" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
        </label>

        <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-2">
          {files.map(file => {
            // แก้ URL ให้ชี้ไปที่ถัง user-files
            const fileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${file.name}`;
            const isSelected = selectedFileUrl === fileUrl;
            return (
              <div key={file.id || file.name} className={`p-3 rounded text-sm border shadow-sm transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <p className="truncate text-gray-800 font-medium mb-2" title={file.name}>{file.name}</p>
                
                <div className="flex space-x-2 items-center">
                  <button onClick={(e) => handleViewFile(e, fileUrl, file.name)} className="text-xs text-blue-600 hover:underline">
                    ดูไฟล์
                  </button>
                  
                  <button 
                    onClick={() => setSelectedFileUrl(isSelected ? '' : fileUrl)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${isSelected ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}
                  >
                    {isSelected ? 'ยกเลิกแนบ' : 'แนบส่ง AI'}
                  </button>

                  <div className="flex-1"></div>

                  <button
                    onClick={() => handleDeleteFile(file.name)}
                    className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors border border-red-100"
                    title="ลบไฟล์นี้"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button 
          onClick={() => supabase.auth.signOut()} 
          className="mt-4 text-sm text-red-500 hover:underline font-bold"
        >
          ออกจากระบบ
        </button>
      </div>

      {/* --- พื้นที่แชทหลัก (LLM Chat) --- */}
      <div className="flex-1 flex flex-col bg-gray-50">
        <header className="bg-white p-4 shadow-sm border-b">
          <h1 className="text-xl font-bold text-gray-800">💬 AI Chat Assistant (RAG Enabled)</h1>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-2xl p-4 rounded-lg shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 border border-gray-200'}`}>
                
                {msg.role === 'user' && msg.fileUrl && (
                  <div className="mb-2 text-xs bg-blue-500 p-1 rounded inline-block text-white">
                    📎 แนบไฟล์ไปแล้ว
                  </div>
                )}
                
                <div className="prose prose-sm max-w-none text-current">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>

              {msg.role === 'ai' && (
                <div className="mt-1 text-xs text-gray-500 flex space-x-3 font-medium">
                  <span>⚡ Tokens used: {msg.tokens || 0}</span>
                  <span>🔍 Citation: {msg.citation}</span>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t flex flex-col shadow-sm">
          {selectedFileUrl && (
             <div className="text-sm text-blue-600 mb-2 font-medium">
               📎 กำลังแนบไฟล์ไปกับคำถาม (กดที่ปุ่ม 'ยกเลิกแนบ' ในแถบด้านซ้ายเพื่อเอาออก)
             </div>
          )}
          <div className="flex space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="พิมพ์คำถามของคุณตรงนี้... (รองรับการถามเกี่ยวกับไฟล์ที่แนบ)"
              className="flex-1 border border-gray-300 bg-white text-gray-900 rounded-lg p-3 focus:outline-none focus:border-blue-500 shadow-sm"
            />
            <button
              onClick={sendMessage}
              disabled={loadingChat}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 font-bold shadow-sm transition-colors"
            >
              {loadingChat ? 'กำลังคิด...' : 'ส่ง'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}