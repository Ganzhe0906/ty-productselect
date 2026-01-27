'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Product, exportToExcel } from '@/lib/excel';
import { ProductCard } from '@/components/ProductCard';
import { Upload, Download, RefreshCw, CheckCircle2, AlertCircle, Terminal, Check, X, Loader2, Archive, Library, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { saveToPending, saveToCompleted, getPendingLibrary, getCompletedLibrary, deletePendingItem, deleteCompletedItem, LibraryItem } from '@/lib/storage';

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
  const [view, setView] = useState<'home' | 'pending' | 'completed'>('home');
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [isImportingToLibrary, setIsImportingToLibrary] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);
  const [currentLibraryType, setCurrentLibraryType] = useState<'pending' | 'completed' | null>(null);
  const mainRef = useRef<HTMLElement>(null);

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
  }, []);

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

  useEffect(() => {
    if (view === 'pending') {
      getPendingLibrary().then(setLibraryItems);
    } else if (view === 'completed') {
      getCompletedLibrary().then(setLibraryItems);
    }
  }, [view]);

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
      if (data.success || data.data) {
        setDebugResult(data.data);
      } else {
         // Fallback for unexpected errors
         setDebugResult({
             success: false,
             steps: [
                 { name: 'Request', status: 'error', message: data.error || 'Unknown error', timestamp: Date.now() }
             ],
             error: data.error
         });
      }
    } catch (err: any) {
        setDebugResult({
             success: false,
             steps: [
                 { name: 'Network', status: 'error', message: err.message || 'Network error', timestamp: Date.now() }
             ],
             error: err.message
         });
    } finally {
      setIsDebugLoading(false);
    }
  };

  const processLocalize = async (file: File, saveToLib: boolean = false) => {
    console.log('开始本地化处理:', file.name, 'saveToLibrary:', saveToLib);
    setIsLoading(true);
    setError(null);
    setLocalizeProgress(0);
    setLocalizeStatus('正在准备处理...');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (geminiApiKey) {
        formData.append('apiKey', geminiApiKey);
        formData.append('model', geminiModel);
      }

      const response = await fetch('/api/localize', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = '图片本地化失败';
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch (e) {
          errorMsg = `请求失败: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let fileBase64 = '';
      let partialLine = '';
      let productsData: Product[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const content = partialLine + chunk;
        const lines = content.split('\n');
        
        partialLine = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === 'progress') {
              setLocalizeProgress(data.progress);
              setLocalizeStatus(data.message);
            } else if (data.type === 'file') {
              fileBase64 = data.data;
            } else if (data.type === 'products') {
              // Assuming the API might return products data directly for saving
              productsData = data.data;
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          } catch (e) {
            console.error('解析流数据失败:', e, line);
          }
        }
      }

      if (!fileBase64) throw new Error('未收到处理后的文件数据');

      // 将 base64 转回 blob
      const byteCharacters = atob(fileBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

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
      } else {
        // Original download logic
        if ('showSaveFilePicker' in window) {
          try {
            const handle = await (window as any).showSaveFilePicker({
              suggestedName: file.name.replace('.xlsx', '_local.xlsx'),
              types: [{
                description: 'Excel 文件',
                accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
              }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            setLocalizeStatus('✅ 处理完成！文件已保存。');
          } catch (saveErr: any) {
            if (saveErr.name !== 'AbortError') {
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = file.name.replace('.xlsx', '_local.xlsx');
              a.click();
              window.URL.revokeObjectURL(url);
              setLocalizeStatus('✅ 处理完成！Localized Excel 已下载。');
            } else {
              setLocalizeStatus('已取消保存');
            }
          }
        } else {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name.replace('.xlsx', '_local.xlsx');
          a.click();
          window.URL.revokeObjectURL(url);
          setLocalizeStatus('✅ 处理完成！Localized Excel 已下载。');
        }
      }
      
      setTimeout(() => setLocalizeStatus(null), 5000);
    } catch (err) {
      console.error('处理错误:', err);
      setError(err instanceof Error ? err.message : '处理失败');
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
      setIsFinished(true);
    }
  }, [currentIndex, products]);

  // Handle auto-save when finished
  useEffect(() => {
    if (isFinished && likedProducts.length > 0) {
      saveToCompleted(currentFileName || '未命名选品', likedProducts, currentLibraryId || undefined)
        .then(() => console.log('Saved to completed library'))
        .catch(err => console.error('Failed to save to completed library:', err));
    }
  }, [isFinished]);

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
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          products: productsToExport,
          libraryId,
          type
        }),
      });

      if (!response.ok) throw new Error('导出失败');

      const blob = await response.blob();
      
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: 'Excel 文件',
              accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
            }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (err: any) {
          if (err.name !== 'AbortError') throw err;
        }
      } else {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
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
    const suffix = isFinished || currentLibraryType === 'completed' ? '已完成' : '待完成';
    const fileName = `${currentFileName.replace('.xlsx', '')}_${suffix}_${dateStr}.xlsx`;
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
    setCurrentFileName('');
  };

  const isInitial = products.length === 0 && !isLoading;

  if (!mounted) return null;

  return (
    <main 
      ref={mainRef}
      className="h-screen flex flex-col items-center justify-start p-2 md:p-4 bg-[#F2F2F7] overflow-hidden"
    >
      <div className="w-full max-w-6xl flex flex-col py-2 h-full">
        
        {/* iOS Style Header - More Compact */}
        <div className="mb-3 md:mb-4 flex justify-between items-center px-2 md:px-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-xl md:text-2xl font-black text-black tracking-tight">
              Product<span className="text-[#007AFF]">Select</span>
            </h1>
            <p className="text-[#8E8E93] font-medium text-[10px] md:text-xs">iOS 26 High-Speed Selection</p>
          </div>
          {view === 'home' && products.length > 0 && !isFinished && (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[10px] md:text-xs font-bold text-black">{currentIndex + 1} <span className="text-[#8E8E93]">/ {products.length}</span></div>
                <div className="text-[8px] md:text-[9px] font-bold text-[#34C759] uppercase tracking-widest">Liked: {likedProducts.length}</div>
              </div>
              <button onClick={reset} className="p-1.5 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                <RefreshCw size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Main Content Area - Expanded */}
        <div className="flex-1 relative mb-2 overflow-hidden">
          <AnimatePresence mode="wait">
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
                      reset();
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

                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                  {libraryItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[#8E8E93]">
                      <Library size={48} className="mb-4 opacity-20" />
                      <p>暂无数据</p>
                    </div>
                  ) : (
                    libraryItems.map((item) => (
                      <div 
                        key={item.id}
                        className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-blue-200 transition-colors"
                      >
                        <div className="flex-1 min-w-0 mr-4">
                          <h3 className="font-bold text-black truncate">{item.name}</h3>
                          <div className="flex items-center gap-3 text-[10px] text-[#8E8E93] mt-1">
                            <span className="bg-gray-100 px-2 py-0.5 rounded-md font-bold text-black">
                              {item.products.length} Items
                            </span>
                            <span>{new Date(item.timestamp).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {view === 'pending' && (
                            <button
                              onClick={() => {
                                setProducts(item.products);
                                setCurrentFileName(item.name);
                                setCurrentLibraryId(item.id);
                                setCurrentLibraryType('pending');
                                setCurrentIndex(0);
                                setLikedProducts([]);
                                setView('home');
                              }}
                              className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                              title="开始选品"
                            >
                              <Check size={18} />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
                              const suffix = view === 'completed' ? '已完成' : '待完成';
                              const fileName = `${item.name.replace('.xlsx', '')}_${suffix}_${dateStr}.xlsx`;
                              performExport(item.products, fileName, item.id, view as any);
                            }}
                            className="p-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors"
                            title="导出 Excel"
                          >
                            <Download size={18} />
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm('确定要删除吗？')) {
                                if (view === 'pending') {
                                  await deletePendingItem(item.id);
                                  getPendingLibrary().then(setLibraryItems);
                                } else {
                                  await deleteCompletedItem(item.id);
                                  getCompletedLibrary().then(setLibraryItems);
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
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {/* 1. Initial Upload State */}
            {view === 'home' && products.length === 0 && !isLoading && (
              <motion.div
                key="initial"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 ios-card bg-white/80 ios-blur flex flex-col items-center p-6 md:p-12 text-center overflow-y-auto custom-scrollbar"
              >
                <div className="w-16 h-16 md:w-24 md:h-24 bg-[#007AFF]/10 rounded-[1.5rem] md:rounded-[2rem] flex items-center justify-center mb-6 md:mb-8 text-[#007AFF]">
                  <Upload size={40} strokeWidth={2.5} />
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-black mb-3 md:mb-4 tracking-tight">Ready to Select?</h2>
                
                <p className="text-[#8E8E93] max-w-xs mx-auto text-base md:text-lg mb-8 md:mb-10 leading-relaxed">
                  Import your Excel product list and start the high-speed selection process.
                </p>
                <div className="flex flex-col gap-3 md:gap-4 w-full max-w-sm mx-auto">
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setView('pending')}
                      className="bg-white text-black border-2 border-black px-4 py-4 rounded-[1.2rem] font-bold ios-button shadow-lg text-sm flex items-center justify-center gap-2"
                    >
                      <Archive size={18} />
                      待选品库
                    </button>
                    <button 
                      onClick={() => setView('completed')}
                      className="bg-white text-black border-2 border-black px-4 py-4 rounded-[1.2rem] font-bold ios-button shadow-lg text-sm flex items-center justify-center gap-2"
                    >
                      <Library size={18} />
                      完成选品库
                    </button>
                  </div>

                  <div className="h-px bg-gray-200 my-2" />
                  
                  <div className="flex flex-col gap-3">
                    <label 
                      htmlFor="localize-upload"
                      className="bg-[#007AFF] text-white px-6 md:px-10 py-4 md:py-5 rounded-[1.2rem] md:rounded-[1.5rem] font-bold ios-button cursor-pointer shadow-2xl shadow-blue-500/20 text-base md:text-lg tracking-tight flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={20} />
                      新鲜网页转永久
                    </label>

                    <label 
                      htmlFor="library-import"
                      className="bg-white text-[#007AFF] border-2 border-[#007AFF] px-6 md:px-10 py-4 md:py-5 rounded-[1.2rem] md:rounded-[1.5rem] font-bold ios-button cursor-pointer shadow-xl text-base md:text-lg tracking-tight flex items-center justify-center gap-2"
                    >
                      <Upload size={20} />
                      导入选品文件
                      <input 
                        id="library-import"
                        type="file" 
                        accept=".xlsx, .xls" 
                        onChange={handleImportToLibrary} 
                        className="hidden" 
                      />
                    </label>
                  </div>

                  {/* History Records Section */}
                  {historyRecords.length > 0 && (
                    <div className="mt-8 w-full">
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

            {/* 3. Selection State */}
            {view === 'home' && products.length > 0 && !isFinished && !isLoading && (
              <motion.div 
                key="selection"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 px-4 flex flex-col"
              >
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
                  <ProductCard 
                    key={currentIndex}
                    product={products[currentIndex]} 
                    onSwipe={handleSwipe} 
                    isTop={true} 
                  />
                </div>

                {/* Shortcuts / Info - Moved inside selection view */}
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
              </motion.div>
            )}

            {/* 4. Finished State */}
            {view === 'home' && isFinished && (
              <motion.div
                key="finished"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 ios-card bg-white/80 ios-blur flex flex-col items-center justify-center p-6 md:p-12 text-center"
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
          <div className="fixed inset-0 flex flex-col items-center justify-center p-6 text-center z-[9999] bg-white/60 backdrop-blur-md">
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
      </div>
    </main>
  );
}
