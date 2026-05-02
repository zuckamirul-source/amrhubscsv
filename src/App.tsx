import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Download, 
  Trash2, 
  Settings, 
  RefreshCw, 
  AlertCircle,
  Home,
  FileSpreadsheet,
  Plus,
  CheckCircle2,
  Loader2,
  X,
  ExternalLink,
  LogIn,
  LogOut,
  User as UserIcon,
  Cloud,
  Cpu,
  Activity,
  Database,
  Check,
  Edit3,
  Sun,
  Moon,
  PartyPopper,
  Trophy,
  AlertTriangle
} from 'lucide-react';
import Papa from 'papaparse';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { cn, fileToBase64, resizeImage } from './lib/utils';
import { generateMetadata, AISericeEngine } from './services/aiService';
import { SHUTTERSTOCK_CATEGORIES } from './constants';
import { ImageMetadata, ShutterstockCSVRow, Marketplace } from './types';
import { useAuth } from './contexts/AuthContext';
import { signInWithGoogle, logout, db, handleFirestoreError, OperationType, updateProfile } from './lib/firebase';

export default function App() {
  const { user } = useAuth();
  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchStartTime, setBatchStartTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [engine, setEngine] = useState<AISericeEngine>(() => (localStorage.getItem('ai_engine') as AISericeEngine) || 'mistral');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('app_theme') as 'light' | 'dark') || 'dark');
  const [marketplace] = useState<Marketplace>('shutterstock');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [mistralApiKeys, setMistralApiKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('mistral_api_keys');
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : ['', '', '', '', '', '', '', '', '', ''];
      }
    } catch (e) {
      console.error("Failed to parse mistral keys", e);
    }
    return ['', '', '', '', '', '', '', '', '', ''];
  });
  const [geminiApiKeys, setGeminiApiKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('gemini_api_keys');
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : ['', '', '', '', '', '', '', '', '', ''];
      }
    } catch (e) {
      console.error("Failed to parse gemini keys", e);
    }
    return ['', '', '', '', '', '', '', '', '', ''];
  });
  const [keywordCount, setKeywordCount] = useState<number>(() => {
    const saved = localStorage.getItem('keyword_count');
    const val = saved ? parseInt(saved, 10) : 35;
    return Math.max(25, Math.min(45, val));
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Timer for time estimation
  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isProcessing) {
      interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isProcessing]);

  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const stats = {
    total: images.length,
    pending: images.filter(i => i.status === 'pending').length,
    processing: images.filter(i => i.status === 'processing').length,
    completed: images.filter(i => i.status === 'completed').length,
    error: images.filter(i => i.status === 'error').length,
  };

  const overallProgress = stats.total > 0 
    ? ((stats.completed / stats.total) * 100) + (images.filter(i => i.status === 'processing').reduce((acc, i) => acc + (i.progress || 0), 0) / stats.total)
    : 0;

  // Estimated Time Remaining (ETR)
  const getETR = () => {
    if (!isProcessing || !batchStartTime || stats.completed === 0) return null;
    const elapsed = currentTime - batchStartTime;
    const avgTimePerImg = elapsed / stats.completed;
    const remaining = stats.total - stats.completed;
    const etr = avgTimePerImg * remaining;
    
    if (etr <= 0) return null;
    
    const minutes = Math.floor(etr / 60000);
    const seconds = Math.floor((etr % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const regenerateFailed = () => {
    const failedOnes = images.filter(i => i.status === 'error');
    if (failedOnes.length === 0) return;
    
    // Reset status to pending before processing and reset retry count
    setImages(prev => prev.map(i => i.status === 'error' ? { ...i, status: 'pending', error: undefined, progress: 0, retries: 0 } : i));
    
    const filesToProcess = failedOnes
      .map(i => i.originalFile)
      .filter((f): f is File => !!f);
      
    processImages(failedOnes, filesToProcess as unknown as FileList);
  };
  React.useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setShowScrollTop(true);
      } else {
        setShowScrollTop(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Sync with Firestore when user is logged in
  React.useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    
    // Subscribe to changes
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.mistralApiKeys && Array.isArray(data.mistralApiKeys)) {
          const keys = [...data.mistralApiKeys];
          while (keys.length < 10) keys.push('');
          const finalKeys = keys.slice(0, 10);
          setMistralApiKeys(finalKeys);
          localStorage.setItem('mistral_api_keys', JSON.stringify(finalKeys));
        }
        if (data.geminiApiKeys && Array.isArray(data.geminiApiKeys)) {
          const keys = [...data.geminiApiKeys];
          while (keys.length < 10) keys.push('');
          const finalKeys = keys.slice(0, 10);
          setGeminiApiKeys(finalKeys);
          localStorage.setItem('gemini_api_keys', JSON.stringify(finalKeys));
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  const handleMistralApiKeyChange = async (index: number, val: string) => {
    const newKeys = [...mistralApiKeys];
    newKeys[index] = val;
    setMistralApiKeys(newKeys);
    localStorage.setItem('mistral_api_keys', JSON.stringify(newKeys));

    if (user) {
      setIsSyncing(true);
      try {
        await setDoc(doc(db, 'users', user.uid), {
          mistralApiKeys: newKeys,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleGeminiApiKeyChange = async (index: number, val: string) => {
    const newKeys = [...geminiApiKeys];
    newKeys[index] = val;
    setGeminiApiKeys(newKeys);
    localStorage.setItem('gemini_api_keys', JSON.stringify(newKeys));

    if (user) {
      setIsSyncing(true);
      try {
        await setDoc(doc(db, 'users', user.uid), {
          geminiApiKeys: newKeys,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleUpdateName = async () => {
    if (!user || !editedName.trim()) return;
    try {
      await updateProfile(user, { displayName: editedName });
      setIsEditingName(false);
      // We don't strictly need to force reload because the user object 
      // is usually kept in sync or we can rely on local state if we want 
      // but for this app a simple session-only override or re-render is fine.
    } catch (error) {
      console.error("Failed to update name", error);
    }
  };

  const changeEngine = (newEngine: AISericeEngine) => {
    setEngine(newEngine);
    localStorage.setItem('ai_engine', newEngine);
  };

  // removed changeMarketplace as only one marketplace exists now

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFiles = async (files: FileList) => {
    const newImages: ImageMetadata[] = Array.from(files).map((file) => {
      const f = file as File;
      return {
        id: Math.random().toString(36).substring(7),
        filename: f.name,
        preview: URL.createObjectURL(f),
        title: f.name.split('.')[0],
        description: '',
        keywords: [],
        category1: '',
        category2: '',
        status: 'pending',
        originalFile: f,
      };
    });

    setImages((prev) => [...prev, ...newImages]);
    processImages(newImages, files);
  };

  const retryImage = async (id: string) => {
    const img = images.find(i => i.id === id);
    if (!img || !img.originalFile) return;

    await processImages([img], [img.originalFile] as unknown as FileList);
  };

  const onFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) handleFiles(event.target.files);
  };

  const processImages = async (newImages: ImageMetadata[], files: FileList) => {
    setIsProcessing(true);
    setBatchStartTime(Date.now());
    let successCount = 0;

    // Unified Engine Pool: Combine all active keys from both providers for parallel grid processing
    const activeMistral = mistralApiKeys.filter(k => k.trim() !== '').map(k => ({ engine: 'mistral' as AISericeEngine, key: k }));
    const activeGemini = geminiApiKeys.filter(k => k.trim() !== '').map(k => ({ engine: 'gemini' as AISericeEngine, key: k }));
    
    const availableNodes = [...activeMistral, ...activeGemini];

    if (availableNodes.length === 0) {
      setIsProcessing(false);
      alert("Please configure at least one API Key (Mistral or Gemini) in the Neural Grid settings.");
      return;
    }

    const processFile = async (img: ImageMetadata, file: File, nodeIndex: number) => {
      const MAX_RETRIES = 3;
      let currentAttempt = img.retries || 0;

      const runAttempt = async (): Promise<boolean> => {
        setImages(prev => prev.map(i => i.id === img.id ? { 
          ...i, 
          status: 'processing', 
          progress: 0, 
          startTime: Date.now(),
          retries: currentAttempt 
        } : i));
        
        const progressInterval = setInterval(() => {
          setImages(prev => prev.map(i => {
            if (i.id === img.id && i.status === 'processing') {
              const currentProgress = i.progress || 0;
              const inc = Math.max(0.1, (98 - currentProgress) / 25);
              return { ...i, progress: Math.min(98, currentProgress + inc) };
            }
            return i;
          }));
        }, 300);
        
        try {
          const { base64, mimeType } = await resizeImage(file, 1024, 1024);
          
          // Neural Grid Rotation: Switch between engines based on rotation through pool
          const node = availableNodes[(nodeIndex + currentAttempt) % availableNodes.length];

          const metadata = await generateMetadata(
            base64, 
            mimeType, 
            node.engine, 
            node.key,
            keywordCount,
            marketplace
          );
          
          if (!metadata) throw new Error("AI Engine returned empty result");

          const normalizedCat1 = SHUTTERSTOCK_CATEGORIES.find(c => c.toLowerCase() === (metadata.category1 || '').toLowerCase()) || (SHUTTERSTOCK_CATEGORIES.includes(metadata.category1) ? metadata.category1 : SHUTTERSTOCK_CATEGORIES[15]);
          const normalizedCat2 = SHUTTERSTOCK_CATEGORIES.find(c => c.toLowerCase() === (metadata.category2 || '').toLowerCase()) || (SHUTTERSTOCK_CATEGORIES.includes(metadata.category2) ? metadata.category2 : "");

          setImages(prev => prev.map(i => i.id === img.id ? { 
            ...i, 
            description: metadata.description || '',
            keywords: Array.isArray(metadata.keywords) ? metadata.keywords : [],
            category1: normalizedCat1,
            category2: normalizedCat2,
            status: 'completed',
            progress: 100
          } : i));
          successCount++;
          clearInterval(progressInterval);
          return true;
        } catch (error: any) {
          clearInterval(progressInterval);
          console.error(`Attempt ${currentAttempt + 1} failed for`, img.filename, error);
          
          if (currentAttempt < MAX_RETRIES) {
            currentAttempt++;
            // Exponential backoff or just a small delay
            await new Promise(resolve => setTimeout(resolve, 1000 * currentAttempt));
            return await runAttempt();
          }

          setImages(prev => prev.map(i => i.id === img.id ? { 
            ...i, 
            status: 'error',
            error: error.message || 'IO Failure',
            progress: 0,
            retries: currentAttempt
          } : i));
          return false;
        }
      };

      await runAttempt();
    };

    // Turbo Performance Tuning: Massive parallel chunks across the dual-engine grid
    const limit = Math.max(100, availableNodes.length * 10); 
    for (let i = 0; i < newImages.length; i += limit) {
      const chunk = newImages.slice(i, i + limit);
      const chunkFiles = Array.from(files).slice(i, i + limit);
      // Process using the full neural grid capacity
      await Promise.all(chunk.map((img, idx) => processFile(img, chunkFiles[idx], i + idx)));
      
      // Minimal breather to prevent UI freeze without sacrificing throughput
      if (i + limit < newImages.length) {
        await new Promise(resolve => setTimeout(resolve, 20)); 
      }
    }
    
    setIsProcessing(false);
    setBatchStartTime(null);
    
    // Trigger modal only if there was at least one success in THIS batch
    if (successCount > 0) {
      setShowExportModal(true);
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const updateMetadata = (id: string, field: keyof ImageMetadata, value: any) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, [field]: value } : img));
  };

  const exportCSV = () => {
    const csvData: ShutterstockCSVRow[] = images
      .filter(img => img.status === 'completed')
      .map(img => {
        // Combine categories for the official Shutterstock column
        const cats = [img.category1, img.category2].filter(Boolean).join(', ');
        
        return {
          Filename: img.filename,
          Description: (img.description || '').substring(0, 200), // Shutterstock limit
          Keywords: (img.keywords || []).join(', '),
          "Category 1": img.category1 || 'Nature',
          "Category 2": img.category2 || '',
          Categories: cats || 'Nature', // Fallback to Nature if both empty
          Editorial: "No",
          "Mature Content": "No",
          Illustration: "No",
        };
      });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${marketplace}_metadata_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearAll = () => {
    setImages([]);
  };

  return (
    <div className="min-h-screen text-[var(--text-main)] font-sans">
      <div className="animate-mesh" />
      <div className="scanning-line" />
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass rounded-none border-x-0 border-t-0 border-white/[0.03] backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-500/20 group cursor-pointer hover:rotate-3 transition-transform">
              <Cpu className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-[0.1em] text-white uppercase flex items-center gap-2">
                Amirhub <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[8px] font-bold border border-indigo-500/20">v3.0.PRO</span>
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <p className="text-[8px] uppercase font-bold tracking-widest text-slate-500">Neural Synthesis Active</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/5">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Engine</span>
              <div className="w-[1px] h-3 bg-white/10 mx-1" />
              <button 
                onClick={() => changeEngine(engine === 'gemini' ? 'mistral' : 'gemini')}
                className="text-[9px] font-black text-indigo-400 uppercase tracking-widest hover:text-indigo-300 transition-colors"
              >
                {engine}
              </button>
            </div>
            
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-all"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-400" />}
            </button>

            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <Settings className={cn("w-5 h-5 transition-transform duration-500", showSettings && "rotate-90")} />
            </button>

            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-white/5">
                <div className="text-right hidden md:block">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input 
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        className="bg-black/40 border border-indigo-500/30 rounded-lg px-2 py-0.5 text-[10px] text-white focus:outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateName();
                          if (e.key === 'Escape') setIsEditingName(false);
                        }}
                      />
                      <button onClick={handleUpdateName} className="text-emerald-400 hover:text-emerald-300">
                        <Check className="w-3 h-3" />
                      </button>
                      <button onClick={() => setIsEditingName(false)} className="text-slate-500 hover:text-slate-400">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="group/name flex items-center gap-2 justify-end">
                      <div className="text-[10px] font-bold text-white leading-tight">{user.displayName || 'No Name'}</div>
                      <button 
                        onClick={() => {
                          setEditedName(user.displayName || '');
                          setIsEditingName(true);
                        }}
                        className="opacity-0 group-hover/name:opacity-100 transition-opacity"
                      >
                        <Edit3 className="w-3 h-3 text-indigo-400" />
                      </button>
                    </div>
                  )}
                  <button onClick={logout} className="text-[8px] font-bold text-indigo-400/60 hover:text-indigo-400 uppercase tracking-widest">Terminate Session</button>
                </div>
                <img src={user.photoURL || ''} className="w-10 h-10 rounded-xl border-2 border-indigo-500/20 shadow-lg" alt="" />
              </div>
            ) : (
              <button onClick={signInWithGoogle} className="btn-primary pl-4 pr-5 flex items-center gap-3 text-white">
                <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center">
                  <LogIn className="w-3 h-3" />
                </div>
                Connect Terminal
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Upload Zone */}
        {images.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 lg:mt-24 max-w-4xl mx-auto"
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <label className={cn(
              "glass p-12 lg:p-32 flex flex-col items-center justify-center cursor-pointer transition-all group border-dashed relative overflow-hidden",
              isDragging ? "border-indigo-500 bg-indigo-500/5 scale-[1.01]" : "hover:bg-white/[0.02] hover:border-indigo-500/20"
            )}>
              <input 
                type="file" 
                ref={fileInputRef}
                multiple 
                accept="image/*" 
                onChange={onFileUpload}
                className="hidden" 
              />
              
              <div className="w-20 h-20 glass flex items-center justify-center mb-8 group-hover:scale-110 group-hover:bg-indigo-500/10 transition-transform relative">
                <Upload className="w-10 h-10 text-indigo-400" />
                <div className="absolute inset-0 border border-indigo-500/20 rounded-xl animate-ping opacity-10" />
              </div>
              
              <h2 className="text-4xl lg:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-indigo-200 to-cyan-400 mb-6 text-center tracking-tighter uppercase leading-[0.85]">
                Neural Asset<br />Synthesis
              </h2>
              <p className="text-[11px] text-slate-500 uppercase tracking-[0.5em] font-black mb-12 text-center flex items-center gap-4">
                <span className="w-8 h-[1px] bg-white/5" />
                Neural Metadata Pipeline v3.0
                <span className="w-8 h-[1px] bg-white/5" />
              </p>
              
              <div className="flex items-center gap-4">
                <div className="btn-primary flex items-center gap-4 !rounded-xl !px-10 h-14 shadow-indigo-500/10 active:scale-95 transition-transform">
                  <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center">
                    <Plus className="w-4 h-4" />
                  </div>
                  <span className="text-[11px]">Primary Entry Point</span>
                </div>
              </div>

              <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-[var(--border)] pt-12 w-full">
                {[
                  { id: '01', title: 'Neural Analysis', desc: 'Advanced LLVM models extract deep semantic meaning from pixels.' },
                  { id: '02', title: 'SEO Clustering', desc: 'Keywords prioritized by search volume and commercial intent.' },
                  { id: '03', title: 'Asset Standard', desc: 'Metadata optimized for professional Shutterstock submission standards.' }
                ].map((item) => (
                  <div key={item.id} className="text-center group/item px-4">
                    <div className="text-indigo-400 font-mono text-lg mb-2 opacity-40 group-hover/item:opacity-100 transition-opacity">{item.id}</div>
                    <div className="text-[10px] text-white font-bold uppercase tracking-widest mb-1">{item.title}</div>
                    <div className="text-[10px] text-slate-500 leading-relaxed font-medium">{item.desc}</div>
                  </div>
                ))}
              </div>
            </label>
          </motion.div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
              <div>
                <h2 className="text-[9px] uppercase font-black font-mono mb-2 text-indigo-400 tracking-[0.3em] flex items-center gap-2">
                  <div className="w-2 h-[2px] bg-indigo-500" />
                  Real-time Asset Pipeline
                </h2>
                <div className="flex items-baseline gap-4">
                  <span className="text-6xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-400 to-magenta-400 animate-gradient-x neon-glow">
                    {images.filter(i => i.status === 'completed').length}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-[12px] font-black text-white tracking-widest leading-none">/ {images.length}</span>
                    <span className="text-[8px] uppercase font-bold tracking-[0.3em] text-slate-600 mt-1">Processed Assets</span>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex bg-black/40 p-1.5 rounded-xl border border-white/5 mr-2 shadow-inner">
                  <div className="px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)]">
                    Shutterstock
                  </div>
                </div>
                
                <div className="h-10 w-[1px] bg-white/5 mx-2 hidden md:block" />
                
                {stats.error > 0 && (
                  <button 
                    onClick={regenerateFailed}
                    disabled={isProcessing}
                    className="h-10 px-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] uppercase font-black tracking-widest hover:bg-red-500/20 transition-all flex items-center gap-2 group disabled:opacity-50"
                  >
                    <RefreshCw className={cn("w-3 h-3 transition-transform duration-700", isProcessing ? "animate-spin" : "group-hover:rotate-180")} />
                    Restore {stats.error} Failures
                  </button>
                )}
                
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-secondary h-10 px-5 flex items-center gap-3 group"
                >
                  <Plus className="w-4 h-4 text-indigo-400 group-hover:rotate-90 transition-transform" />
                  <span className="group-hover:translate-x-0.5 transition-transform">Ingest New</span>
                </button>
                
                {images.length > 0 && (
                  <button 
                    onClick={exportCSV}
                    disabled={stats.completed === 0}
                    className="btn-primary h-10 px-6 flex items-center gap-3 disabled:opacity-30 disabled:grayscale"
                  >
                    <Download className="w-4 h-4" />
                    Archive Batch
                  </button>
                )}
                
                {images.length > 0 && (
                  <button 
                    onClick={clearAll}
                    className="w-10 h-10 rounded-xl glass border-dashed border-red-500/20 text-red-500/40 hover:text-red-500 hover:bg-red-500/5 transition-all flex items-center justify-center"
                    title="Purge Active Batch"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <input type="file" ref={fileInputRef} multiple accept="image/*" onChange={onFileUpload} className="hidden" />
              </div>
            </div>

            {/* Batch Status Dashboard */}
            <div className="glass p-8 border-indigo-500/10 bg-indigo-500/[0.01] relative overflow-hidden group/dash">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover/dash:opacity-10 transition-opacity">
                <Cloud className="w-32 h-32 text-indigo-400" />
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-10 relative">
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-black tracking-[0.3em] text-slate-600 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                    Cycles Completed
                  </div>
                  <div className="text-4xl font-black tracking-tighter text-emerald-400 tabular-nums">{stats.completed}</div>
                  <div className="text-[10px] font-bold text-slate-800 uppercase tracking-widest">Metadata Blocks Sync'd</div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-black tracking-[0.3em] text-slate-600 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                    System Faults
                  </div>
                  <div className="text-4xl font-black tracking-tighter text-red-400 tabular-nums">{stats.error}</div>
                  <div className="text-[10px] font-bold text-slate-800 uppercase tracking-widest">Protocol Errors Detected</div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-black tracking-[0.3em] text-slate-600 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                    Pending Buffer
                  </div>
                  <div className="text-4xl font-black tracking-tighter text-indigo-400 tabular-nums">{stats.pending + stats.processing}</div>
                  <div className="text-[10px] font-bold text-slate-800 uppercase tracking-widest">Awaiting Neural Map</div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-black tracking-[0.3em] text-slate-600 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                    Time to Finish
                  </div>
                  <div className="text-4xl font-black tracking-tighter text-white tabular-nums">
                    {isProcessing ? (getETR() || "CALC...") : "--"}
                  </div>
                  <div className="text-[10px] font-bold text-slate-800 uppercase tracking-widest">Engine Estimation</div>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between items-end px-1">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      {isProcessing ? (
                        <div className="flex gap-1 items-end h-3">
                          <motion.div animate={{ height: [4, 12, 4], backgroundColor: ['#818cf8', '#22d3ee', '#818cf8'] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-[3px] rounded-full" />
                          <motion.div animate={{ height: [8, 4, 8], backgroundColor: ['#22d3ee', '#f472b6', '#22d3ee'] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-[3px] rounded-full" />
                          <motion.div animate={{ height: [6, 10, 6], backgroundColor: ['#f472b6', '#818cf8', '#f472b6'] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-[3px] rounded-full" />
                        </div>
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                      )}
                      <span className="text-[11px] uppercase font-black tracking-[0.3em] text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-400 to-magenta-400 animate-gradient-x">
                        {isProcessing ? "Synthesizing Neural Metadata Pipeline" : "Neural Pipeline Hibernating"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[16px] font-black font-mono text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-cyan-300 to-magenta-300 animate-gradient-x neon-glow">{Math.round(overallProgress)}</span>
                    <span className="text-[8px] font-bold text-indigo-300/40 uppercase tracking-widest">% Sync</span>
                  </div>
                </div>
                <div className="w-full h-3 bg-white/[0.03] rounded-full overflow-hidden relative border border-white/5 p-0.5">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${overallProgress}%` }}
                    className="h-full bg-gradient-to-r from-indigo-600 via-cyan-500 via-magenta-500 to-indigo-600 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.5)] relative overflow-hidden animate-gradient-x"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2s_infinite]" />
                  </motion.div>
                </div>
              </div>
            </div>

            {/* Data Grid */}
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {images.map((img, index) => (
                  <motion.div 
                    layout
                    key={img.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ 
                      opacity: 1, 
                      y: 0,
                      transition: { delay: Math.min(index * 0.05, 0.5) }
                    }}
                    exit={{ opacity: 0, scale: 0.99 }}
                    className={cn(
                      "glass overflow-hidden border transition-all hover:border-indigo-500/20 group/row",
                      img.status === 'processing' ? "bg-indigo-500/[0.03] border-indigo-500/20" : "border-[var(--border)]",
                      img.status === 'error' && "border-red-500/10 bg-red-500/[0.02]"
                    )}
                  >
                    <div className="flex flex-col lg:flex-row gap-4 p-3 lg:p-4">
                      {/* Asset Preview (Smaller Left Side) */}
                      <div className="w-20 lg:w-24 space-y-2 flex-shrink-0">
                        <div className="relative aspect-square rounded-lg overflow-hidden glass border-indigo-500/10 shadow-lg">
                          <img 
                            src={img.preview} 
                            alt={img.filename} 
                            className="w-full h-full object-cover transition-transform duration-700 group-hover/row:scale-110"
                          />
                          {img.status === 'processing' && (
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex flex-col items-center justify-center">
                              <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                            </div>
                          )}
                          {img.status === 'completed' && (
                            <div className="absolute top-1 right-1 bg-green-500 p-0.5 rounded-full shadow-lg">
                              <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                          {img.status === 'error' && (
                            <div className="absolute inset-0 bg-red-950/40 backdrop-blur-[2px] flex items-center justify-center">
                              <AlertCircle className="w-5 h-5 text-red-400" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="text-[8px] font-mono truncate text-slate-500 font-medium text-center px-0.5">
                            {img.filename}
                          </div>
                        </div>
                      </div>

                      {/* Metadata Details (Right Side) */}
                      <div className="flex-1 space-y-5">
                        <div className="flex items-center gap-3">
                          <div className="h-[1px] flex-1 bg-white/5"></div>
                          <span className="text-[7px] uppercase font-black tracking-[0.5em] text-indigo-400 opacity-40">
                            {marketplace} Synthesis Pipeline
                          </span>
                          <div className="h-[1px] flex-1 bg-white/5"></div>
                        </div>
                        
                        {img.status === 'error' ? (
                          <div className="h-full flex flex-col justify-center items-start gap-4 p-4 bg-red-500/5 border border-red-500/10 rounded-lg">
                            <div className="flex items-center gap-3 text-red-400">
                              <AlertCircle className="w-5 h-5 flex-shrink-0" />
                              <div className="space-y-0.5">
                                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em]">Processing Failed</h4>
                                <p className="text-[11px] font-medium leading-relaxed opacity-80 decoration-red-500/30 underline-offset-2">
                                  {img.error || "The remote neural cluster returned an empty response. Verify your API keys and connection protocol."}
                                </p>
                              </div>
                            </div>
                            <button 
                              onClick={() => retryImage(img.id)}
                              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Regenerate Metadata
                            </button>
                          </div>
                        ) : img.status === 'processing' ? (
                          <div className="h-full flex flex-col justify-center gap-4 p-6 bg-indigo-500/[0.02] border border-indigo-500/10 rounded-lg">
                            <div className="space-y-4">
                              <div className="flex justify-between items-end">
                                <div className="space-y-1">
                                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400">Neural Mapping in Progress</h4>
                                  <p className="text-[11px] text-slate-500 font-medium tracking-tight">Synthesizing visual semantics and commercial SEO vectors...</p>
                                </div>
                                <span className="text-3xl font-black font-mono text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-cyan-300 to-magenta-300 animate-gradient-x neon-glow">{Math.round(img.progress || 0)}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${img.progress || 0}%` }}
                                  className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500 animate-gradient-x shadow-[0_0_15px_rgba(34,211,238,0.5)] rounded-full"
                                />
                              </div>
                              <div className="flex justify-between text-[8px] font-mono uppercase tracking-widest text-slate-600">
                                <span>Status: active_inference_mode</span>
                                <span>{((Date.now() - (img.startTime || Date.now())) / 1000).toFixed(1)}s elapsed</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-5 h-full">
                            {/* Categories Selection */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <label className="text-[8px] uppercase font-black tracking-widest text-cyan-400/60 px-1">Primary Category</label>
                                <select 
                                  value={img.category1}
                                  onChange={(e) => updateMetadata(img.id, 'category1', e.target.value)}
                                  className="w-full bg-black/40 border border-white/5 rounded-lg px-4 py-2.5 text-[11px] font-bold text-indigo-300 uppercase tracking-tight focus:border-indigo-500/30 outline-none transition-all cursor-pointer hover:bg-black/60 shadow-inner"
                                >
                                  {SHUTTERSTOCK_CATEGORIES.map(cat => (
                                    <option key={cat} value={cat} className="bg-slate-900">{cat}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[8px] uppercase font-black tracking-widest text-magenta-400/60 px-1">Secondary Category</label>
                                <select 
                                  value={img.category2}
                                  onChange={(e) => updateMetadata(img.id, 'category2', e.target.value)}
                                  className="w-full bg-black/40 border border-white/5 rounded-lg px-4 py-2.5 text-[11px] font-bold text-slate-400 uppercase tracking-tight focus:border-white/20 outline-none transition-all cursor-pointer hover:bg-black/60 shadow-inner"
                                >
                                  <option value="" className="bg-slate-900">None</option>
                                  {SHUTTERSTOCK_CATEGORIES.map(cat => (
                                    <option key={cat} value={cat} className="bg-slate-900">{cat}</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                              {/* Description */}
                              <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                  <label className="text-[8px] uppercase font-black tracking-[0.2em] text-slate-500">SEO Optimized Description</label>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[8px] font-mono font-bold text-indigo-500/40 bg-indigo-500/5 px-1.5 py-0.5 rounded">{(img.description || '').length} symbols</span>
                                  </div>
                                </div>
                                <div className="relative group/field">
                                  <textarea 
                                    value={img.description || ''}
                                    onChange={(e) => updateMetadata(img.id, 'description', e.target.value)}
                                    placeholder="Generated description..."
                                    className="w-full bg-black/40 border border-white/5 rounded-xl px-5 py-4 text-[12px] leading-relaxed font-serif text-slate-300 min-h-[110px] focus:border-indigo-500/30 focus:bg-black/60 outline-none transition-all shadow-inner"
                                  />
                                  <div className="absolute bottom-3 right-3 opacity-0 group-hover/field:opacity-100 transition-opacity pointer-events-none">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                                  </div>
                                </div>
                              </div>

                              {/* Keywords */}
                              <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                  <label className="text-[8px] uppercase font-black tracking-[0.2em] text-slate-500">Commercial Keyword Pool</label>
                                  <span className="text-[8px] font-mono font-bold text-indigo-500/40 bg-indigo-500/5 px-1.5 py-0.5 rounded">{(img.keywords || []).length} tags</span>
                                </div>
                                <div className="relative group/field">
                                  <textarea 
                                    value={(img.keywords || []).join(', ')}
                                    onChange={(e) => updateMetadata(img.id, 'keywords', e.target.value.split(',').map(s => s.trim()))}
                                    placeholder="Generated keywords..."
                                    className="w-full bg-black/40 border border-white/5 rounded-xl px-5 py-4 text-[10px] font-mono tracking-tight text-indigo-400/70 min-h-[110px] focus:border-indigo-500/30 focus:bg-black/60 outline-none transition-all shadow-inner"
                                  />
                                  <div className="absolute bottom-3 right-3 opacity-0 group-hover/field:opacity-100 transition-opacity pointer-events-none">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/50 animate-pulse"></div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex justify-end pt-2 border-t border-white/5">
                              <button 
                                onClick={() => removeImage(img.id)}
                                className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-600 hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                                Clear Entry
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Footer Meta */}
      <footer className="max-w-[1400px] mx-auto p-6 mt-12 mb-24 border-t border-[var(--border)] flex flex-col gap-12">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-[10px] text-slate-500 font-mono">
          <div className="uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            Node: <span className="text-indigo-400">A100-STUDIO-AIS</span> • Sync: <span className="text-green-400">Optimized</span>
          </div>
          <div className="flex flex-wrap gap-6 uppercase tracking-widest">
            <span>Runtime: {new Date().getHours().toString().padStart(2, '0')}:{new Date().getMinutes().toString().padStart(2, '0')} GMT</span>
            <span className="text-white font-bold decoration-indigo-500/30 underline underline-offset-4 cursor-pointer hover:text-indigo-400 transition-colors">Engine Report</span>
          </div>
        </div>

        {/* Multi-Key API Infrastructure */}
        <div className="flex justify-center">
          <div className="glass p-6 lg:p-10 flex flex-col gap-10 border-dashed border-emerald-500/20 bg-emerald-500/[0.02] max-w-4xl w-full">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 glass flex items-center justify-center bg-emerald-500/10 border-emerald-500/20">
                  <RefreshCw className={cn("w-5 h-5 text-emerald-400", isProcessing && "animate-spin")} />
                </div>
                <div>
                  <h4 className="text-lg font-black uppercase tracking-tight text-white">Mistral Cluster <span className="text-emerald-500 font-light ml-2">v5</span></h4>
                  <p className="text-[10px] text-slate-500 uppercase font-black tracking-[0.3em] mt-0.5">Parallel Node Architecture</p>
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-3">
                <div className="flex items-center gap-4">
                  {user && (
                    <div className="flex items-center gap-2 text-[9px] font-bold text-indigo-400 uppercase tracking-widest">
                      {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
                      {isSyncing ? "Syncing..." : "Cloud Active"}
                    </div>
                  )}
                  <a 
                    href="https://console.mistral.ai/api-keys/" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-[9px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded uppercase tracking-widest transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2"
                  >
                    API Keys <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="flex gap-1.5">
                  {mistralApiKeys.map((k, i) => (
                    <div key={i} className={cn("w-2 h-2 rounded-full transition-all duration-700", k.trim() ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-white/5")} />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {mistralApiKeys.map((key, index) => (
                <div key={index} className="space-y-2 group">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-[9px] uppercase font-bold tracking-widest text-slate-500 group-hover:text-emerald-400/60 transition-colors">Mistral Node {index + 1}</label>
                    {key && <span className="text-[7px] font-black text-emerald-500 uppercase tracking-tighter">Verified</span>}
                  </div>
                  <input 
                    type="password"
                    value={key}
                    onChange={(e) => handleMistralApiKeyChange(index, e.target.value)}
                    placeholder={`Auth Key`}
                    className={cn(
                      "w-full bg-black/40 border rounded-lg px-4 py-2.5 text-[10px] font-mono outline-none transition-all",
                      key ? "border-emerald-500/20 text-emerald-300 focus:border-emerald-500/50" : "border-[var(--border)] text-slate-400 italic"
                    )}
                  />
                </div>
              ))}
            </div>

            {/* Gemini API Keys */}
            <div className="pt-6 border-t border-white/5 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-black text-white uppercase tracking-tighter">Gemini Flash Neural Grid</h3>
                    <div className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded text-[7px] font-black text-indigo-400 uppercase tracking-widest">v1.5 Flash</div>
                  </div>
                  <div className="flex gap-1.5">
                    {geminiApiKeys.map((k, i) => (
                      <div key={i} className={cn("w-2 h-2 rounded-full transition-all duration-700", k.trim() ? "bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-white/5")} />
                    ))}
                  </div>
                </div>
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-[9px] font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2 self-start md:self-center"
                >
                  Get Gemini Keys <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {geminiApiKeys.map((key, index) => (
                  <div key={index} className="space-y-2 group">
                    <div className="flex justify-between items-center px-1">
                      <label className="text-[9px] uppercase font-bold tracking-widest text-slate-500 group-hover:text-indigo-400/60 transition-colors">Gemini Node {index + 1}</label>
                      {key && <span className="text-[7px] font-black text-indigo-500 uppercase tracking-tighter">Verified</span>}
                    </div>
                    <input 
                      type="password"
                      value={key}
                      onChange={(e) => handleGeminiApiKeyChange(index, e.target.value)}
                      placeholder={`Gemini API Key`}
                      className={cn(
                        "w-full bg-black/40 border rounded-lg px-4 py-2.5 text-[10px] font-mono outline-none transition-all",
                        key ? "border-indigo-500/20 text-indigo-300 focus:border-indigo-500/50" : "border-[var(--border)] text-slate-400 italic"
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Floating Home Button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed bottom-8 left-1/2 z-[90]"
          >
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="group relative flex items-center gap-3 px-6 py-3 bg-indigo-600/20 backdrop-blur-3xl border border-indigo-500/20 rounded-full shadow-[0_0_30px_rgba(79,70,229,0.2)] hover:bg-indigo-600/30 transition-all duration-300"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg shadow-indigo-500/50">
                <Home className="w-4 h-4 text-white" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Return to Top</span>
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(99,102,241,1)]" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0c0e14]/80 backdrop-blur-md z-[100] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass w-full max-w-xl p-10 space-y-8 shadow-2xl shadow-indigo-600/10"
            >
              <div className="flex justify-between items-center border-b border-white/10 pb-6">
                <div>
                  <h3 className="text-2xl font-bold uppercase tracking-tight text-white">System Calibration</h3>
                  <p className="text-[10px] uppercase font-bold tracking-widest text-indigo-400 mt-1">Configuring Batch Integration Node</p>
                </div>
                <button onClick={() => setShowSettings(false)} className="w-12 h-12 glass flex items-center justify-center hover:bg-white/5 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
                       <div className="space-y-8 text-slate-300">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-black tracking-widest text-slate-500">Node Cluster</label>
                    <div className="p-3 bg-black/40 border border-white/5 text-[11px] font-mono rounded-lg text-indigo-300">Pixtral-12B-2409</div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-black tracking-widest text-slate-500">Sampling Temp</label>
                    <div className="flex items-center gap-3 bg-black/40 border border-white/5 p-3 rounded-lg">
                      <div className="flex-1 h-2 bg-black/60 rounded-full overflow-hidden border border-white/5 p-[1px]">
                        <div className="w-[85%] h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500 animate-gradient-x rounded-full"></div>
                      </div>
                      <span className="text-[10px] font-mono text-indigo-400">0.85</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[9px] uppercase font-black tracking-widest text-slate-500">Keyword Density</label>
                    <span className="text-[10px] font-mono text-indigo-400 font-bold">{keywordCount} KW</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" 
                      min="25" 
                      max="50" 
                      step="1"
                      value={keywordCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setKeywordCount(val);
                        localStorage.setItem('keyword_count', val.toString());
                      }}
                      className="flex-1 h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer accent-indigo-500 border border-white/5"
                    />
                    <div className="flex gap-2">
                      {[25, 35, 50].map((v) => (
                        <button 
                          key={v}
                          onClick={() => {
                            setKeywordCount(v);
                            localStorage.setItem('keyword_count', v.toString());
                          }}
                          className={cn(
                            "px-3 py-1.5 text-[9px] font-bold rounded-lg border transition-all",
                            keywordCount === v ? "bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/20" : "bg-black/20 border-white/5 text-slate-500 hover:text-white"
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-black tracking-widest text-slate-500">Output Target</label>
                  <select className="w-full bg-black/40 border border-white/5 p-4 text-[11px] font-mono text-white focus:bg-black/60 transition-colors rounded-lg outline-none cursor-pointer">
                    <option>SHUTTERSTOCK_V2_GENERIC</option>
                  </select>
                </div>

                <div className="bg-indigo-500/[0.03] border border-indigo-500/10 p-5 rounded-xl text-[10px] flex gap-4">
                  <AlertCircle className="w-5 h-5 text-indigo-500/40 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-indigo-400 font-bold uppercase tracking-widest">Inference Protocol</p>
                    <p className="leading-relaxed text-slate-500 uppercase tracking-wider font-medium">
                      Optimized for commercial stock photography standards.
                    </p>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full bg-indigo-600 text-white py-5 rounded-xl font-bold uppercase tracking-[0.2em] hover:bg-indigo-500 active:scale-[0.98] transition-all shadow-xl shadow-indigo-600/20"
              >
                Commit Changes
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Status Overlay */}
      {isProcessing && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 glass px-8 py-4 flex items-center gap-6 shadow-2xl z-50 border-indigo-500/30">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            <span className="text-[11px] uppercase font-black tracking-[0.3em] text-white">Neural Mapping Active</span>
          </div>
          <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden border border-white/5">
            <motion.div 
               animate={{ x: [-192, 192] }}
               transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
               className="w-full h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-magenta-500 shadow-[0_0_15px_rgba(34,211,238,0.8)]"
            />
          </div>
        </div>
      )}

      {/* Export Completion Modal */}
      <AnimatePresence>
        {showExportModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0c0e14]/90 backdrop-blur-xl z-[150] flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="glass w-full max-w-md overflow-hidden relative"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-emerald-500 to-indigo-500 animate-gradient-x" />
              
              <div className="p-8 lg:p-10 space-y-8 text-center">
                <div className="flex justify-center">
                  <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center relative">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: [1, 1.5, 1] }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                      className="absolute inset-0 bg-emerald-500/20 rounded-full -z-10"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-3xl font-serif italic text-white">Batch Finalized</h3>
                  <p className="text-[10px] uppercase font-bold tracking-[0.4em] text-indigo-400">Neural Metadata Generation Complete</p>
                </div>

                <div className="grid grid-cols-2 gap-4 py-6 border-y border-white/5">
                  <div className="text-center">
                    <div className="text-2xl font-serif text-white">{images.filter(i => i.status === 'completed').length}</div>
                    <div className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Successfully Vectorized</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-serif text-red-500/60 font-mono">{images.filter(i => i.status === 'error').length}</div>
                    <div className="text-[8px] uppercase tracking-widest text-slate-500 font-bold">Protocol Failures</div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      exportCSV();
                      setShowExportModal(false);
                    }}
                    className="btn-primary w-full h-14 flex items-center justify-center gap-3 text-sm tracking-[0.2em]"
                  >
                    <Download className="w-5 h-5" />
                    Download CSV
                  </button>
                  <button 
                    onClick={() => setShowExportModal(false)}
                    className="text-[9px] uppercase font-bold tracking-[0.2em] text-slate-600 hover:text-slate-400 py-3 transition-colors"
                  >
                    Dismiss Notification
                  </button>
                </div>
              </div>

              <div className="bg-black/40 p-4 border-t border-white/5 flex items-center justify-center gap-3">
                <div className="status-dot bg-emerald-500" />
                <span className="text-[8px] font-mono text-slate-600 uppercase tracking-tighter">Ready for Shutterstock ingestion protocol</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
