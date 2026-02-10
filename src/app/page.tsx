'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Product, exportToExcel } from '@/lib/excel';
import { ProductCard } from '@/components/ProductCard';
import { Upload, Download, RefreshCw, CheckCircle2, AlertCircle, Terminal, Check, X, Loader2, Archive, Library, Trash2, Edit2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { saveToPending, saveToCompleted, getPendingLibrary, getCompletedLibrary, deletePendingItem, deleteCompletedItem, LibraryItem, getLibraryDetail, renameLibrary } from '@/lib/storage';
import * as XLSX from 'xlsx';

// 静态账户配置
const USERS = {
  'flz': '19960206',
  'lyy': '19980407'
};

// 添加 Debug 类型定义
interface DebugStep {
  name: string;
  status: 'pending' | 'success' | 'error' | 'warning';
  message: string;
  data?: any;
  timestamp: number;
}

interface DebugResult {
  steps: DebugStep[];
  success: boolean;
  finalResult?: any;
  error?: string;
}

interface HistoryRecord {
  id: string;
  name: string;
  products: Product[];
  currentIndex: number;
  likedProducts: Product[];
  timestamp: number;
  currentLibraryId?: string | null;
  currentLibraryType?: 'pending' | 'completed' | null;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedProducts, setLikedProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localizeStatus, setLocalizeStatus] = useState<string | null>(null);
  const [localizeProgress, setLocalizeProgress] = useState<number>(0);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3-flash-preview');
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [isDebugLoading, setIsDebugLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Auth states
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'pending' | 'completed'>('home');
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [isImportingToLibrary, setIsImportingToLibrary] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);
  const [currentLibraryType, setCurrentLibraryType] = useState<'pending' | 'completed' | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Editing state for renaming
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Scheduler states
  const [schedulerError, setSchedulerError] = useState<{
    batchIndex: number;
    totalBatches: number;
    message: string;
    retryAction: () => void;
    abortAction: () => void;
  } | null>(null);

  // Scroll to top when view changes
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo(0, 0);
    }
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    setMounted(true);
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedModel = localStorage.getItem('gemini_model');
    if (savedKey) setGeminiApiKey(savedKey);
    if (savedModel) setGeminiModel(savedModel);

    // Load history records
    const savedHistory = localStorage.getItem('selection_history');
    if (savedHistory) {
      try {
        setHistoryRecords(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse history:', e);
      }
    }

    // Check login state
    const savedUser = localStorage.getItem('app_user');
    if (savedUser) {
      setCurrentUser(savedUser);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const password = USERS[loginUsername as keyof typeof USERS];
    if (password && password === loginPassword) {
      setCurrentUser(loginUsername);
      localStorage.setItem('app_user', loginUsername);
      setAuthError(null);
    } else {
      setAuthError('账号或密码错误');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('app_user');
    setLoginUsername('');
    setLoginPassword('');
  };

  // Helper to extract URL from various formats
  const extractUrl = (src: any): string => {
    if (!src) return '';
    let url = '';
    if (typeof src === 'object' && src !== null) {
      url = src.hyperlink || src.text || '';
    } else {
      url = String(src);
    }
    if (!url) return '';
    const srcMatch = url.match(/src=["']?([^"'\s>]+)["']?/i);
    if (srcMatch && srcMatch[1]) return srcMatch[1];
    const urlMatch = url.match(/(https?:\/\/[^\s"'<>]+)/i);
    if (urlMatch && urlMatch[0]) return urlMatch[0];
    return url.trim();
  };

  const handleRename = async (id: string, newName: string) => {
    if (editingId !== id) return; // Prevent double calls from onBlur + Enter
    
    if (!newName.trim() || newName === libraryItems.find(i => i.id === id)?.name) {
      setEditingId(null);
      return;
    }

    setIsLibraryLoading(true);
    try {
      await renameLibrary(id, newName);
      // Refresh library
      const items = view === 'pending' ? await getPendingLibrary() : await getCompletedLibrary();
      setLibraryItems(items);
      setEditingId(null);
    } catch (err: any) {
      alert('重命名失败: ' + err.message);
    } finally {
      setIsLibraryLoading(false);
    }
  };

  const saveToHistory = () => {
     const now = new Date();
     const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
     const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '');
     const formattedName = `${(currentFileName || '未命名选品').replace('.xlsx', '')}_${dateStr}_${timeStr}`;

     const newRecord: HistoryRecord = {
       id: Math.random().toString(36).substring(7),
       name: formattedName,
       products,
       currentIndex,
       likedProducts,
       timestamp: Date.now(),
       currentLibraryId,
       currentLibraryType
     };
 
     const updatedHistory = [newRecord, ...historyRecords];
     setHistoryRecords(updatedHistory);
     localStorage.setItem('selection_history', JSON.stringify(updatedHistory));
     alert('进度已保存');
   };

  const deleteHistoryRecord = (id: string) => {
    const updatedHistory = historyRecords.filter(r => r.id !== id);
    setHistoryRecords(updatedHistory);
    localStorage.setItem('selection_history', JSON.stringify(updatedHistory));
  };

  const resumeHistoryRecord = (record: HistoryRecord) => {
    setProducts(record.products);
    setCurrentIndex(record.currentIndex);
    setLikedProducts(record.likedProducts);
    setCurrentFileName(record.name);
    setCurrentLibraryId(record.currentLibraryId || null);
    setCurrentLibraryType(record.currentLibraryType || null);
    setIsFinished(false);
    setView('home');
  };

  const fetchLibrary = useCallback(async () => {
    if (view === 'pending') {
      setIsLibraryLoading(true);
      try {
        const items = await getPendingLibrary();
        setLibraryItems(items);
      } finally {
        setIsLibraryLoading(false);
      }
    } else if (view === 'completed') {
      setIsLibraryLoading(true);
      try {
        const items = await getCompletedLibrary();
        setLibraryItems(items);
      } finally {
        setIsLibraryLoading(false);
      }
    }
  }, [view]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // Save settings to localStorage
  const saveSettings = (key: string, model: string) => {
    setGeminiApiKey(key);
    setGeminiModel(model);
    localStorage.setItem('gemini_api_key', key);
    localStorage.setItem('gemini_model', model);
  };

  const testConnection = async () => {
    if (!geminiApiKey) {
      alert('请先输入 API Key');
      return;
    }

    setIsDebugLoading(true);
    setDebugResult(null);
    try {
      const response = await fetch('/api/debug/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: geminiApiKey, model: geminiModel }),
      });

      const data = await response.json();
      if (data.success) {
        alert('✅ ' + (data.message || 'API Key 有效！'));
      } else {
        alert('❌ ' + (data.error || 'API Key 无效，请检查'));
      }
    } catch (err: any) {
      alert('❌ 网络请求失败，请检查连接或代理');
    } finally {
      setIsDebugLoading(false);
    }
  };

  const processLocalize = async (file: File, saveToLib: boolean = false) => {
    console.log('开始本地化处理 (前端调度模式):', file.name, 'saveToLibrary:', saveToLib);
    setIsLoading(true);
    setError(null);
    setLocalizeProgress(0);
    setLocalizeStatus('正在准备处理...');
    setSchedulerError(null);

    try {
      // 1. 读取 Excel 文件
      const dataBuffer = await file.arrayBuffer();
      const workbookXLSX = XLSX.read(dataBuffer, { type: 'array' });
      const sheetName = workbookXLSX.SheetNames[0];
      const worksheetXLSX = workbookXLSX.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheetXLSX, { header: 1, defval: "" }) as any[][];

      if (rawData.length === 0) throw new Error('Excel 文件为空');

      const headers = rawData[0] as string[];
      const rows = rawData.slice(1);

      // 识别字段
      const knownImageHeaders = ['主图src', 'src', '_original_url_'];
      const knownTitleHeaders = ['商品标题', '商品名', 'title', 'name'];
      const srcField = headers.find(h => knownImageHeaders.includes(h)) || headers[0];
      const titleField = headers.find(h => knownTitleHeaders.includes(h));

      if (!titleField) throw new Error('未在 Excel 中找到商品标题列');

      const allData = rows.map(row => {
        const obj: any = {};
        headers.forEach((h, i) => obj[h] = row[i]);
        // 预存原始图片 URL 用于后续 Finalize
        obj._original_image_url_ = extractUrl(obj[srcField]);
        return obj;
      });

      // 2. 分批处理 AI 总结
      const batchSize = 30;
      const totalBatches = Math.ceil(allData.length / batchSize);
      
      for (let i = 0; i < allData.length; i += batchSize) {
        const batchIndex = Math.floor(i / batchSize) + 1;
        const currentBatch = allData.slice(i, i + batchSize);
        const titles = currentBatch.map(d => d[titleField]).filter(Boolean);

        let success = false;
        while (!success) {
          try {
            setLocalizeStatus(`🤖 正在分析第 ${batchIndex}/${totalBatches} 批商品名...`);
            setLocalizeProgress(5 + Math.floor((batchIndex / totalBatches) * 60));

            const response = await fetch('/api/localize/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ titles, apiKey: geminiApiKey, model: geminiModel }),
            });

            if (!response.ok) {
              const errData = await response.json();
              throw new Error(errData.error || 'AI 处理失败');
            }

            const { summaries } = await response.json();
            summaries.forEach((res: any, idx: number) => {
              if (currentBatch[idx]) {
                currentBatch[idx]['中文商品名'] = res.name;
                currentBatch[idx]['场景用途'] = res.scenario;
              }
            });
            success = true;
          } catch (err: any) {
            console.error(`Batch ${batchIndex} failed:`, err);
            
            // 等待用户决策
            const decision = await new Promise<'retry' | 'abort'>((resolve) => {
              setSchedulerError({
                batchIndex,
                totalBatches,
                message: err.message,
                retryAction: () => resolve('retry'),
                abortAction: () => resolve('abort')
              });
            });

            setSchedulerError(null);
            if (decision === 'abort') {
              throw new Error('用户取消了任务');
            }
            // If retry, the loop continues and tries again
          }
        }
      }

      // 3. 准备 Finalize 阶段的列定义
      const finalColumns: any[] = [];
      headers.forEach(k => {
        if (k && !k.startsWith('_')) {
          finalColumns.push({ header: k, key: k, width: 25 });
          if (k === titleField) {
            finalColumns.push({ header: '中文商品名', key: '中文商品名', width: 30 });
            finalColumns.push({ header: '场景用途', key: '场景用途', width: 30 });
          }
        }
      });
      finalColumns.push({ header: '主图src', key: '主图src', width: 25 });

      // 4. 调用 Finalize API 处理图片和生成文件
      setLocalizeStatus('🖼️ AI 分析完成！正在处理图片并生成最终文件...');
      setLocalizeProgress(70);

      const finalizeResponse = await fetch('/api/localize/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          data: allData, 
          headers, 
          finalColumns, 
          srcField 
        }),
      });

      if (!finalizeResponse.ok) throw new Error('最终合成失败');

      const reader = finalizeResponse.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let fileBase64 = '';
      let partialLine = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + chunk).split('\n');
        partialLine = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.type === 'progress') {
              setLocalizeProgress(70 + Math.floor((json.progress / 100) * 30));
              setLocalizeStatus(json.message);
            } else if (json.type === 'file') {
              fileBase64 = json.data;
            } else if (json.type === 'error') {
              throw new Error(json.message);
            }
          } catch (e) {
            console.error('Finalize stream error:', e);
          }
        }
      }

      if (!fileBase64) throw new Error('未收到最终文件数据');

      // 5. 下载或保存
      const byteCharacters = atob(fileBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      if (saveToLib) {
        const formData = new FormData();
        const fileToUpload = new File([blob], file.name, { type: blob.type });
        formData.append('file', fileToUpload);
        formData.append('type', 'pending');

        const saveResponse = await fetch('/api/library', {
          method: 'POST',
          body: formData,
        });

        if (!saveResponse.ok) throw new Error('保存到库失败');
        setLocalizeStatus('✅ 已成功导入待选品库并保存到本地！');
        
        // 如果当前正在待选品库视图，则刷新列表
        if (view === 'pending') {
          await fetchLibrary();
        }
      } else {
        // 使用传统下载方式，绕过 showSaveFilePicker 在长异步任务后的用户手势校验限制
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name.replace('.xlsx', '_local.xlsx');
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setLocalizeStatus('✅ 处理完成！Localized Excel 已下载。');
      }

      setTimeout(() => setLocalizeStatus(null), 5000);
    } catch (err: any) {
      console.error('处理过程被中断:', err);
      setError(err.message || '处理失败');
      setLocalizeStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocalizeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processLocalize(file, false);
    e.target.value = '';
  };

  const handleImportToLibrary = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setIsLoading(true);
      setError(null);
      setLocalizeStatus('正在导入并提取图片...');
      
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'pending');

        const response = await fetch('/api/library', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || '导入失败');
        }

        setLocalizeStatus('✅ 已成功导入待选品库并保存到本地！');
        setTimeout(() => setLocalizeStatus(null), 3000);
      } catch (err) {
        console.error('导入错误:', err);
        setError(err instanceof Error ? err.message : '导入失败');
      } finally {
        setIsLoading(false);
        e.target.value = '';
      }
    };

  const handleSwipe = useCallback((direction: 'left' | 'right' | 'up') => {
    if (direction === 'up') {
      handleBack();
      return;
    }

    const currentProduct = products[currentIndex];
    
    if (direction === 'right') {
      setLikedProducts(prev => {
        // 使用唯一标识符（如商品ID或索引）来检查是否已存在
        const isDuplicate = prev.some(p => 
          (p['商品ID'] && p['商品ID'] === currentProduct['商品ID']) || 
          (p._index && p._index === currentProduct._index)
        );
        if (isDuplicate) return prev;
        return [...prev, currentProduct];
      });
    }

    if (currentIndex < products.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      console.log('Selection finished, setting isFinished to true');
      setIsFinished(true);
    }
  }, [currentIndex, products]);

  // Handle auto-save when finished
  useEffect(() => {
    const autoSave = async () => {
      if (isFinished && likedProducts.length > 0 && !isSaving) {
        setIsSaving(true);
        try {
          const completedName = `${(currentFileName || '未命名选品').replace('.xlsx', '')}_${currentUser || '未知'}`;
          await saveToCompleted(completedName, likedProducts, currentLibraryId || undefined, currentUser || undefined);
          console.log('Saved to completed library');
        } catch (err) {
          console.error('Failed to save to completed library:', err);
          alert('保存选品结果失败，请尝试手动导出或重新进入。');
        } finally {
          setIsSaving(false);
        }
      }
    };
    
    autoSave();
  }, [isFinished, likedProducts, currentFileName, currentLibraryId, currentUser]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      const prevProduct = products[prevIndex];
      
      // 当返回上一个产品时，从已选中列表中移除它（如果存在）
      // 这样用户可以重新决定是右滑（保留）还是左滑（舍弃）
      setLikedProducts(prev => prev.filter(p => 
        !((p['商品ID'] && p['商品ID'] === prevProduct['商品ID']) || 
          (p._index && p._index === prevProduct._index))
      ));
      
      setCurrentIndex(prevIndex);
    }
  }, [currentIndex, products]);

  // Add keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if we are in the selection state
      if (products.length > 0 && !isFinished && !isLoading) {
        if (e.key === 'ArrowLeft') {
          handleSwipe('left');
        } else if (e.key === 'ArrowRight') {
          handleSwipe('right');
        } else if (e.key === 'ArrowUp') {
          handleBack();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [products.length, isFinished, isLoading, handleSwipe, handleBack]);

  const performExport = async (productsToExport: Product[], fileName: string, libraryId?: string, type?: string) => {
    if (productsToExport.length === 0) {
      alert('没有喜欢的商品可以导出');
      return;
    }
    
    setIsLoading(true);
    setLocalizeStatus('正在生成带图结果，请稍候...');
    
    try {
      console.log(`准备导出 ${productsToExport.length} 个商品...`);
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          products: productsToExport,
          libraryId,
          type
        }),
      });

      const contentType = response.headers.get('content-type');
      if (contentType && (contentType.includes('application/json') || !response.ok)) {
          const text = await response.text();
          try {
              const json = JSON.parse(text);
              throw new Error(json.error || '导出失败');
          } catch (e) {
              // 如果不是 JSON，可能是 HTML 错误页或其他
              console.error('Export failed with non-json response:', text.substring(0, 200));
              throw new Error(`导出请求失败 (${response.status}): ${response.statusText}`);
          }
      }

      if (!response.ok) throw new Error(`导出失败: ${response.status} ${response.statusText}`);

      const blob = await response.blob();
      
      // 使用传统下载方式，因为它对异步任务后的“用户手势”限制较少，能更稳定地支持大文件下载
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      setLocalizeStatus('✅ 选品结果已成功导出！');
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出出错');
    } finally {
      setIsLoading(false);
      setTimeout(() => setLocalizeStatus(null), 3000);
    }
  };

  const handleExport = async () => {
    const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
    // 如果已经在完成选品界面，后缀固定为“已完成”
    const isCompleted = isFinished || currentLibraryType === 'completed';
    const suffix = isCompleted ? '已完成' : '待完成';
    
    let baseName = currentFileName.replace('.xlsx', '');
    // 如果是完成状态，且名字里还没带选品人，则加上选品人
    if (isCompleted && currentUser && !baseName.endsWith(`_${currentUser}`)) {
      baseName = `${baseName}_${currentUser}`;
    }
    
    const fileName = `${baseName}_${suffix}_${dateStr}.xlsx`;
    await performExport(likedProducts, fileName, currentLibraryId || undefined, currentLibraryType || undefined);
  };

  const reset = () => {
    setProducts([]);
    setCurrentIndex(0);
    setLikedProducts([]);
    setIsFinished(false);
    setError(null);
    setCurrentLibraryId(null);
    setCurrentLibraryType(null);
    setLibraryItems([]);
    setLocalizeStatus(null);
    setLocalizeProgress(0);
    setDebugResult(null);
    setIsDebugLoading(false);
    setIsLoading(false);
    setIsLibraryLoading(false);
    setCurrentFileName('');
  };

  const isInitial = products.length === 0 && !isLoading;

  if (!mounted) return null;

  return (
    <main 
      ref={mainRef}
      className="h-screen flex flex-col items-center justify-start p-2 md:p-4 bg-[#F2F2F7] overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {!currentUser ? (
          <motion.div
            key="login"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#F2F2F7] p-6"
          >
            <div className="w-full max-w-sm space-y-8 text-center">
              <div className="space-y-2">
                <h1 className="text-3xl font-black text-black tracking-tight">
                  滑动式<span className="text-[#007AFF]">选品平台</span>
                </h1>
                <p className="text-[#8E8E93] font-medium">请登录以继续</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="账号"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    className="w-full px-5 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF] transition-all text-black font-medium"
                    required
                  />
                  <input
                    type="password"
                    placeholder="密码"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full px-5 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-[#007AFF] transition-all text-black font-medium"
                    required
                  />
                </div>

                {authError && (
                  <motion.p 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[#FF3B30] text-sm font-bold"
                  >
                    {authError}
                  </motion.p>
                )}

                <button
                  type="submit"
                  className="w-full bg-[#007AFF] text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-blue-500/20 active:scale-[0.98] transition-all"
                >
                  登录
                </button>
              </form>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-6xl flex flex-col py-2 h-full"
          >
            {/* iOS Style Header - More Compact */}
            <div className="mb-3 md:mb-4 flex justify-between items-center px-2 md:px-4">
              <div className="flex items-baseline gap-2">
                <h1 className="text-xl md:text-2xl font-black text-black tracking-tight">
                  滑动式<span className="text-[#007AFF]">选品平台</span>
                </h1>
                <p className="text-[#8E8E93] font-medium text-[10px] md:text-xs">极速选品体验</p>
              </div>
              
              <div className="flex items-center gap-3">
                {view === 'home' && products.length > 0 && !isFinished && (
                  <div className="flex items-center gap-3 mr-2">
                    <div className="text-right">
                      <div className="text-[10px] md:text-xs font-bold text-black">{currentIndex + 1} <span className="text-[#8E8E93]">/ {products.length}</span></div>
                      <div className="text-[8px] md:text-[9px] font-bold text-[#34C759] uppercase tracking-widest">Liked: {likedProducts.length}</div>
                    </div>
                    <button onClick={reset} className="p-1.5 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                      <RefreshCw size={14} />
                    </button>
                  </div>
                )}
                
                {/* User Profile */}
                <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
                  <div className="text-right hidden sm:block">
                    <div className="text-[10px] font-bold text-black uppercase">{currentUser}</div>
                  </div>
                  <button 
                    onClick={() => {
                      if (confirm('确定要退出登录吗？')) handleLogout();
                    }}
                    className="w-8 h-8 md:w-10 md:h-10 bg-[#007AFF] text-white rounded-full flex items-center justify-center font-black text-xs md:text-sm shadow-lg shadow-blue-500/20 active:scale-90 transition-transform"
                  >
                    {currentUser.substring(0, 3).toUpperCase()}
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content Area - Expanded */}
            <div className="flex-1 relative mb-2 overflow-hidden">
              <AnimatePresence>
            {/* Library View */}
            {view !== 'home' && (
              <motion.div
                key="library"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="absolute inset-0 ios-card bg-white/80 ios-blur flex flex-col p-4 md:p-8 z-20 overflow-hidden"
              >
                <div className="flex items-center justify-between mb-6">
                  <button 
                    onClick={() => {
                      setView('home');
                      // 不再在这里立即 reset，避免动画过程中数据丢失
                    }}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X size={24} />
                  </button>
                  <h2 className="text-xl font-bold text-black">
                    {view === 'pending' ? '待选品库' : '完成选品库'}
                  </h2>
                  <div className="w-10" /> {/* Spacer */}
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-2 relative custom-scrollbar">
                  {libraryItems.length === 0 && !isLibraryLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-[#8E8E93]">
                      <Library size={48} className="mb-4 opacity-20" />
                      <p>暂无数据</p>
                    </div>
                  ) : (
                    <>
                      {libraryItems.map((item) => (
                        <div 
                          key={item.id}
                          className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-blue-200 transition-colors"
                        >
                          <div className="flex-1 min-w-0 mr-4">
                            <div className="flex items-center gap-2 group/name">
                              {editingId === item.id ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onBlur={() => handleRename(item.id, editingName)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleRename(item.id, editingName);
                                      if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-1 px-2 py-1 bg-blue-50 border border-blue-200 rounded-lg text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                  <button 
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRename(item.id, editingName);
                                    }}
                                    className="p-1 text-green-500 hover:bg-green-50 rounded-md"
                                  >
                                    <Check size={14} />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <h3 className="font-bold text-black truncate">{item.name}</h3>
                                  <button 
                                    type="button"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      setEditingId(item.id);
                                      setEditingName(item.name);
                                    }}
                                    className="p-1 text-gray-400 hover:text-blue-500 opacity-0 group-hover/name:opacity-100 transition-opacity"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-[#8E8E93] mt-1">
                              <span className="bg-gray-100 px-2 py-0.5 rounded-md font-bold text-black">
                                {item.productCount ?? item.products.length} Items
                              </span>
                              <span>{new Date(item.timestamp).toLocaleString()}</span>
                            </div>

                            {/* Collaboration Tags */}
                            {view === 'pending' && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {(!item.completedBy || item.completedBy.length === 0) ? (
                                  <span className="px-2 py-0.5 bg-gray-100 text-gray-400 rounded-md text-[10px] font-bold border border-gray-200">
                                    无人完成
                                  </span>
                                ) : item.completedBy.length >= 2 ? (
                                  <span className="px-2 py-0.5 bg-green-50 text-green-600 rounded-md text-[10px] font-bold border border-green-100 flex items-center gap-1">
                                    <Check size={10} /> 2人完成
                                  </span>
                                ) : (
                                  <>
                                    {/* Individual status for each user */}
                                    {['flz', 'lyy'].map(u => {
                                      const isDone = item.completedBy?.includes(u);
                                      return (
                                        <span 
                                          key={u}
                                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${
                                            isDone 
                                              ? 'bg-blue-50 text-[#007AFF] border-blue-100' 
                                              : 'bg-gray-50 text-gray-400 border-gray-100'
                                          }`}
                                        >
                                          {isDone && <Check size={10} />}
                                          {u.toUpperCase()} {isDone ? '已完成' : '待完成'}
                                        </span>
                                      );
                                    })}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {view === 'pending' && (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setIsLibraryLoading(true);
                                  try {
                                    const detail = await getLibraryDetail(item.id);
                                    setProducts(detail.products);
                                    setCurrentFileName(detail.name);
                                    setCurrentLibraryId(detail.id);
                                    setCurrentLibraryType('pending');
                                    setCurrentIndex(0);
                                    setLikedProducts([]);
                                    setView('home');
                                  } catch (err: any) {
                                    alert('加载详情失败: ' + err.message);
                                  } finally {
                                    setIsLibraryLoading(false);
                                  }
                                }}
                                className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                                title="开始选品"
                              >
                                <Check size={18} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                setIsLibraryLoading(true);
                                try {
                                  const detail = await getLibraryDetail(item.id);
                                  const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
                                  const suffix = view === 'completed' ? '已完成' : '待完成';
                                  const fileName = `${detail.name.replace('.xlsx', '')}_${suffix}_${dateStr}.xlsx`;
                                  await performExport(detail.products, fileName, detail.id, view as any);
                                } catch (err: any) {
                                  alert('导出失败: ' + err.message);
                                } finally {
                                  setIsLibraryLoading(false);
                                }
                              }}
                              className="p-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors"
                              title="导出 Excel"
                            >
                              <Download size={18} />
                            </button>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm('确定要删除吗？')) {
                                  setIsLibraryLoading(true);
                                  try {
                                    if (view === 'pending') {
                                      await deletePendingItem(item.id);
                                      await fetchLibrary();
                                    } else {
                                      await deleteCompletedItem(item.id);
                                      await fetchLibrary();
                                    }
                                  } finally {
                                    setIsLibraryLoading(false);
                                  }
                                }
                              }}
                              className="p-2 text-[#FF3B30] hover:bg-red-50 rounded-xl transition-colors"
                              title="删除"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Library Loading Overlay */}
                  {isLibraryLoading && (
                    <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] z-30 flex flex-col items-center justify-center rounded-2xl transition-all duration-300">
                      <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 flex flex-col items-center space-y-3">
                        <Loader2 size={32} className="text-[#007AFF] animate-spin" />
                        <p className="text-xs font-bold text-black uppercase tracking-wider">正在同步中...</p>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* 1. Initial State - Workflow Design */}
            {view === 'home' && products.length === 0 && !isFinished && (
              <motion.div
                key="initial"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 flex flex-col items-center p-4 md:p-8 overflow-y-auto custom-scrollbar z-10"
              >
                <div className="w-full max-w-4xl space-y-8">
                  {/* Management Section - NOW ON TOP */}
                  <div>
                    <div className="flex items-center gap-2 mb-4 px-2">
                      <Library size={20} className="text-[#007AFF]" />
                      <h3 className="font-bold text-black text-sm uppercase tracking-wider">我的选品仓库</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                      <button 
                        onClick={() => setView('pending')}
                        className="ios-card bg-white p-6 md:p-8 flex items-center gap-6 hover:border-blue-200 transition-all group shadow-sm hover:shadow-md"
                      >
                        <div className="w-12 h-12 md:w-14 md:h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-[#007AFF] group-hover:scale-110 transition-transform">
                          <Archive size={28} />
                        </div>
                        <div className="text-left">
                          <div className="font-bold text-black text-lg md:text-xl">待选品库</div>
                          <p className="text-xs md:text-sm text-[#8E8E93] mt-1">管理已导入的原始数据</p>
                        </div>
                      </button>

                      <button 
                        onClick={() => setView('completed')}
                        className="ios-card bg-white p-6 md:p-8 flex items-center gap-6 hover:border-green-200 transition-all group shadow-sm hover:shadow-md"
                      >
                        <div className="w-12 h-12 md:w-14 md:h-14 bg-green-50 rounded-2xl flex items-center justify-center text-[#34C759] group-hover:scale-110 transition-transform">
                          <CheckCircle2 size={28} />
                        </div>
                        <div className="text-left">
                          <div className="font-bold text-black text-lg md:text-xl">完成选品库</div>
                          <p className="text-xs md:text-sm text-[#8E8E93] mt-1">查看已筛选导出的结果</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Workflow Section - NOW AT BOTTOM */}
                  <div className="pt-8 border-t border-gray-100">
                    <div className="flex items-center gap-2 mb-6 px-2">
                      <RefreshCw size={18} className="text-[#8E8E93]" />
                      <h3 className="font-bold text-[#8E8E93] text-sm uppercase tracking-wider">导入与数据处理</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                      {/* Step 1: Manual Prep */}
                      <div className="ios-card bg-white/40 p-5 flex flex-col items-center text-center space-y-3 border-dashed border-2 border-gray-200 opacity-60">
                        <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400">
                          <span className="text-lg font-black">1</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-black text-sm">采集准备</h3>
                          <p className="text-[10px] text-[#8E8E93] mt-1 leading-relaxed">在出海匠扒下原始数据</p>
                        </div>
                        <div className="flex-1 flex items-end">
                          <span className="text-[9px] font-bold text-gray-300 uppercase tracking-widest px-2 py-0.5 bg-gray-50 rounded-full">外部操作</span>
                        </div>
                      </div>

                      {/* Step 2: Localize */}
                      <div className="ios-card bg-white p-5 flex flex-col items-center text-center space-y-3 shadow-sm border border-blue-50">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-[#007AFF]">
                          <span className="text-lg font-black">2</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-black text-sm">网页转永久</h3>
                          <p className="text-[10px] text-[#8E8E93] mt-1 leading-relaxed">固定图片，确保数据永久可用</p>
                        </div>
                        <div className="w-full">
                          <label 
                            htmlFor="localize-upload"
                            className="block w-full bg-[#007AFF] text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/10 text-center"
                          >
                            开始转换
                          </label>
                          <input 
                            id="localize-upload"
                            type="file" 
                            accept=".xlsx, .xls" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) processLocalize(file, true);
                            }} 
                            className="hidden" 
                          />
                        </div>
                      </div>

                      {/* Step 3: Import */}
                      <div className="ios-card bg-white p-5 flex flex-col items-center text-center space-y-3 shadow-sm border border-green-50">
                        <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-[#34C759]">
                          <span className="text-lg font-black">3</span>
                        </div>
                        <div>
                          <h3 className="font-bold text-black text-sm">导入系统</h3>
                          <p className="text-[10px] text-[#8E8E93] mt-1 leading-relaxed">上传文件进入待选品库</p>
                        </div>
                        <div className="w-full">
                          <label 
                            htmlFor="library-import"
                            className="block w-full bg-white text-[#34C759] border-2 border-[#34C759] py-2 rounded-xl font-bold text-xs cursor-pointer hover:bg-green-50 transition-colors text-center"
                          >
                            导入选品
                          </label>
                          <input 
                            id="library-import"
                            type="file" 
                            accept=".xlsx, .xls" 
                            onChange={handleImportToLibrary} 
                            className="hidden" 
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* History Records Section */}
                  {historyRecords.length > 0 && (
                    <div className="mt-12 pt-8 border-t border-gray-100 w-full">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-black flex items-center gap-2">
                          <Archive size={20} className="text-[#007AFF]" />
                          历史记录
                        </h3>
                        <span className="text-xs text-[#8E8E93] font-medium">{historyRecords.length} 条记录</span>
                      </div>
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {historyRecords.map((record) => (
                          <div 
                            key={record.id}
                            className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-blue-200 transition-all cursor-pointer"
                            onClick={() => resumeHistoryRecord(record)}
                          >
                            <div className="flex-1 min-w-0 text-left">
                              <h4 className="font-bold text-sm text-black truncate">{record.name}</h4>
                              <div className="flex items-center gap-3 text-[10px] text-[#8E8E93] mt-1">
                                <span className="bg-blue-50 text-[#007AFF] px-2 py-0.5 rounded-md font-bold">
                                  进度: {record.currentIndex + 1} / {record.products.length}
                                </span>
                                <span>{new Date(record.timestamp).toLocaleString()}</span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('确定要删除这条记录吗？')) {
                                  deleteHistoryRecord(record.id);
                                }
                              }}
                              className="p-2 text-[#FF3B30] hover:bg-red-50 rounded-xl transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {localizeStatus && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-6 w-full max-w-sm"
                  >
                    <div className="flex justify-between mb-2">
                      <span className="text-[#007AFF] font-bold text-sm">{localizeStatus}</span>
                      {localizeProgress > 0 && (
                        <span className="text-[#007AFF] font-bold text-sm">{Math.round(localizeProgress)}%</span>
                      )}
                    </div>
                    {localizeProgress > 0 && (
                      <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-[#007AFF]"
                          initial={{ width: 0 }}
                          animate={{ width: `${localizeProgress}%` }}
                        />
                      </div>
                    )}
                  </motion.div>
                )}

                {error && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-6 flex items-center gap-2 text-[#FF3B30] font-bold"
                  >
                    <AlertCircle size={20} /> {error}
                  </motion.div>
                )}

                {/* Gemini Settings & AI Test - Moved inside scrollable initial view */}
                <div className="mt-12 mb-4 w-full max-w-sm mx-auto p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3 text-center">AI 总结设置 (可选)</div>
                  <div className="space-y-3">
                    <input 
                      type="password" 
                      placeholder="Gemini API Key" 
                      value={geminiApiKey}
                      onChange={(e) => saveSettings(e.target.value, geminiModel)}
                      className="w-full px-4 py-2 bg-white border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select 
                      value={geminiModel}
                      onChange={(e) => saveSettings(geminiApiKey, e.target.value)}
                      className="w-full px-4 py-2 bg-white border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <optgroup label="Gemini 3 系列 (最新)">
                        <option value="gemini-3-flash-preview">Gemini 3 Flash Preview (推荐)</option>
                        <option value="gemini-3-pro-preview">Gemini 3 Pro Preview</option>
                      </optgroup>
                      <optgroup label="Gemini 2.5 系列">
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash (稳定版)</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro (推理增强)</option>
                        <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                      </optgroup>
                      <optgroup label="其他模型">
                        <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Exp</option>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                      </optgroup>
                    </select>
                    <button
                      onClick={testConnection}
                      disabled={isDebugLoading}
                      className={`w-full py-2 px-4 rounded-xl text-xs font-bold transition-all ${
                        isDebugLoading 
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                          : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
                      }`}
                    >
                      {isDebugLoading ? '正在测试连接...' : '测试 AI 连接'}
                    </button>
                    
                    {debugResult && (
                      <div className="mt-3 space-y-2">
                        {debugResult.steps.map((step, idx) => (
                          <div key={idx} className={`p-2 rounded-lg text-left text-[10px] border ${
                            step.status === 'success' ? 'bg-green-50 border-green-100' :
                            step.status === 'error' ? 'bg-red-50 border-red-100' :
                            step.status === 'pending' ? 'bg-blue-50 border-blue-100' :
                            'bg-gray-50 border-gray-100'
                          }`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`font-bold ${
                                step.status === 'success' ? 'text-green-700' :
                                step.status === 'error' ? 'text-red-700' :
                                'text-blue-700'
                              }`}>
                                {step.status === 'success' && <Check size={10} className="inline mr-1" />}
                                {step.status === 'error' && <X size={10} className="inline mr-1" />}
                                {step.status === 'pending' && <Loader2 size={10} className="inline mr-1 animate-spin" />}
                                {step.name}
                              </span>
                              <span className="text-gray-400 text-[9px]">{new Date(step.timestamp).toLocaleTimeString()}</span>
                            </div>
                            {step.status === 'error' && (
                                <div className="mt-2 p-2 bg-red-100 rounded text-red-700 text-[10px] font-bold">
                                    {step.message.includes('网络连接失败') ? (
                                        <div>
                                            <p className="mb-1">⚠️ 检测到网络连接问题</p>
                                            <p className="font-normal opacity-80">请在终端运行以下命令开启代理：</p>
                                            <code className="block mt-1 p-1 bg-white/50 rounded select-all">export HTTPS_PROXY=http://127.0.0.1:7890</code>
                                        </div>
                                    ) : (
                                        step.message
                                    )}
                                </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* 3. Main Content (Selection or Finished) */}
            {view === 'home' && (products.length > 0 || isFinished) && (
              <motion.div 
                key="home-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col z-10"
              >
                {!isFinished ? (
                  <div className="flex-1 flex flex-col px-4">
                    {/* Top Controls: Progress, Save, Exit */}
                    <div className="mb-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <button 
                          onClick={reset}
                          className="px-4 py-2 bg-white text-[#FF3B30] rounded-xl font-bold text-sm shadow-sm border border-gray-100 hover:bg-red-50 transition-colors flex items-center gap-2"
                        >
                          <X size={16} /> 退出
                        </button>
                        
                        <div className="flex-1 flex flex-col items-center">
                          <div className="text-[10px] font-bold text-black mb-1">
                            {currentIndex + 1} <span className="text-[#8E8E93]">/ {products.length}</span>
                          </div>
                          <div className="w-full h-2 bg-gray-200/50 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${((currentIndex + 1) / products.length) * 100}%` }}
                              className="h-full bg-[#007AFF] shadow-[0_0_10px_rgba(0,122,255,0.5)]"
                            />
                          </div>
                        </div>

                        <button 
                          onClick={saveToHistory}
                          className="px-4 py-2 bg-[#007AFF] text-white rounded-xl font-bold text-sm shadow-sm hover:bg-blue-600 transition-colors flex items-center gap-2"
                        >
                          <Archive size={16} /> 保存
                        </button>
                      </div>
                    </div>

                    {/* Card Stack */}
                    <div className="flex-1 relative">
                      {/* Background Card */}
                      {currentIndex + 1 < products.length && (
                        <ProductCard 
                          product={products[currentIndex + 1]} 
                          onSwipe={() => {}} 
                          isTop={false} 
                        />
                      )}
                      {/* Active Card */}
                      {products[currentIndex] && (
                        <ProductCard 
                          key={currentIndex}
                          product={products[currentIndex]} 
                          onSwipe={handleSwipe} 
                          isTop={true} 
                        />
                      )}
                    </div>

                    {/* Shortcuts / Info */}
                    <div className="flex justify-center gap-6 md:gap-12 mt-4 mb-2">
                      <button 
                        onClick={() => handleSwipe('left')}
                        className="flex flex-col items-center gap-1 ios-button group outline-none"
                        title="Press Left Arrow or Click to Pass"
                      >
                        <div className="px-3 py-1 bg-white rounded-xl shadow-sm border border-gray-100 font-bold text-[#FF3B30] text-[10px] group-active:scale-95 transition-transform">LEFT</div>
                        <span className="text-[8px] font-bold text-[#8E8E93] uppercase tracking-widest">Pass</span>
                      </button>

                      <button 
                        onClick={handleBack}
                        disabled={currentIndex === 0}
                        className={`flex flex-col items-center gap-1 ios-button group outline-none ${currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
                        title="Press Up Arrow or Click to Go Back"
                      >
                        <div className="px-3 py-1 bg-blue-500 rounded-xl shadow-sm font-bold text-white text-[10px] group-active:scale-95 transition-transform">UP</div>
                        <span className="text-[8px] font-bold text-[#8E8E93] uppercase tracking-widest">Back</span>
                      </button>

                      <button 
                        onClick={() => handleSwipe('right')}
                        className="flex flex-col items-center gap-1 ios-button group outline-none"
                        title="Press Right Arrow or Click to Like"
                      >
                        <div className="px-3 py-1 bg-black rounded-xl shadow-sm font-bold text-white text-[10px] group-active:scale-95 transition-transform">RIGHT</div>
                        <span className="text-[8px] font-bold text-[#8E8E93] uppercase tracking-widest">Like</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 text-center bg-white/80 ios-blur ios-card mx-4 mb-4"
                  >
                    <div className="w-16 h-16 md:w-24 md:h-24 bg-[#34C759]/10 rounded-[1.5rem] md:rounded-[2rem] flex items-center justify-center mb-6 md:mb-8 text-[#34C759]">
                      <CheckCircle2 size={48} strokeWidth={2.5} />
                    </div>
                    <h2 className="text-3xl md:text-4xl font-black text-black mb-3 md:mb-4 tracking-tight">Mission Complete</h2>
                    <p className="text-lg md:text-xl mb-8 md:mb-12">
                      Processed <span className="text-black font-bold">{products.length}</span> items<br />
                      You liked <span className="text-[#34C759] font-black">{likedProducts.length}</span> potentials
                    </p>
                    
                    <div className="flex flex-col w-full max-w-sm gap-3 md:gap-4">
                      <button
                        onClick={handleExport}
                        className="w-full bg-[#34C759] text-white py-4 md:py-5 rounded-[1.2rem] md:rounded-[1.5rem] font-bold flex items-center justify-center gap-3 ios-button shadow-2xl shadow-green-500/20 text-base md:text-lg"
                      >
                        <Download size={24} /> Export Results
                      </button>
                      <button
                        onClick={() => {
                          setView('completed');
                          reset();
                        }}
                        className="w-full bg-[#007AFF] text-white py-4 md:py-5 rounded-[1.2rem] md:rounded-[1.5rem] font-bold flex items-center justify-center gap-3 ios-button shadow-2xl shadow-blue-500/20 text-base md:text-lg"
                      >
                        <Library size={24} /> 完成选品库
                      </button>
                      <button
                        onClick={reset}
                        className="w-full bg-gray-100 text-[#8E8E93] py-4 md:py-5 rounded-[1.2rem] md:rounded-[1.5rem] font-bold flex items-center justify-center gap-3 ios-button text-base md:text-lg"
                      >
                        <RefreshCw size={24} /> Start Over
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {/* Hidden Input outside conditional blocks to avoid unmounting during async ops */}
          <input 
            id="localize-upload"
            type="file" 
            accept=".xlsx, .xls" 
            onChange={handleLocalizeUpload} 
            className="hidden" 
          />
        </div>

        {/* 5. Global Loading Overlay - Moved out of the main container and AnimatePresence to ensure it never blocks clicks after loading */}
        {isLoading && (
          <div className="fixed inset-0 flex flex-col items-center justify-center p-6 text-center z-[9999] bg-white/60 backdrop-blur-md pointer-events-auto">
            {!localizeStatus ? (
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 border-4 border-[#007AFF]/20 border-t-[#007AFF] rounded-full animate-spin mb-6" />
                <p className="text-black font-bold text-xl tracking-tight">Analyzing Data...</p>
              </div>
            ) : (
              <div className="w-full max-w-md bg-white p-8 rounded-[2rem] shadow-2xl border border-blue-50">
                <div className="flex justify-between items-end mb-4">
                  <div className="text-left">
                    <div className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mb-1">Processing</div>
                    <div className="text-black font-bold text-lg leading-tight">{localizeStatus}</div>
                  </div>
                  {localizeProgress > 0 && (
                    <div className="text-blue-600 font-black text-2xl tracking-tighter">
                      {Math.round(localizeProgress)}<span className="text-sm ml-0.5">%</span>
                    </div>
                  )}
                </div>
                
                <div className="w-full h-4 bg-blue-50 rounded-full overflow-hidden p-1 border border-blue-100/50">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all duration-300 ease-out"
                    style={{ width: `${localizeProgress || 5}%` }}
                  />
                </div>
                
                <div className="mt-6 flex items-center justify-center gap-2 text-[#8E8E93] text-xs font-medium">
                  <RefreshCw size={12} className="animate-spin" />
                  正在处理中...
                </div>
              </div>
            )}
          </div>
        )}

        {/* 6. Scheduler Error Modal (Retry/Abort) */}
        <AnimatePresence>
          {schedulerError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
              >
                <div className="p-8">
                  <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mb-6">
                    <AlertCircle size={32} />
                  </div>
                  <h3 className="text-2xl font-black text-black mb-2 tracking-tight">AI 处理中断</h3>
                  <p className="text-[#8E8E93] text-sm mb-1 leading-relaxed">
                    在处理第 <span className="text-black font-bold">{schedulerError.batchIndex}/{schedulerError.totalBatches}</span> 批商品时遇到了问题。
                  </p>
                  <div className="bg-red-50 border border-red-100 p-4 rounded-2xl mt-4">
                    <p className="text-red-600 text-xs font-medium break-words leading-relaxed">
                      {schedulerError.message}
                    </p>
                  </div>
                </div>
                <div className="bg-gray-50 p-6 flex flex-col gap-3">
                  <button
                    onClick={schedulerError.retryAction}
                    className="w-full bg-[#007AFF] text-white py-4 rounded-2xl font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={18} /> 重试这一批
                  </button>
                  <button
                    onClick={schedulerError.abortAction}
                    className="w-full bg-white text-red-500 border-2 border-red-50 py-3.5 rounded-2xl font-bold active:scale-95 transition-all"
                  >
                    全部放弃
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 7. Saving Overlay */}
        {isSaving && (
          <div className="fixed inset-0 flex flex-col items-center justify-center p-6 text-center z-[9999] bg-black/40 backdrop-blur-sm pointer-events-auto">
            <div className="bg-white p-8 rounded-[2rem] shadow-2xl flex flex-col items-center space-y-4 max-w-xs w-full">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-blue-100 rounded-full" />
                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Archive size={24} className="text-[#007AFF]" />
                </div>
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-black">正在保存结果</h3>
                <p className="text-xs text-[#8E8E93] mt-1">正在将选品数据同步到服务器...</p>
              </div>
            </div>
          </div>
        )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
