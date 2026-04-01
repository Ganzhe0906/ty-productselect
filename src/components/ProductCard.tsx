'use client';

import React, { useState } from 'react';
import { motion, PanInfo, useMotionValue, useTransform } from 'framer-motion';
import { Product, getProductField } from '@/lib/excel';
import { Heart, X, ShoppingBag, Eye, Loader2, CalendarDays, Video } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onSwipe: (direction: 'left' | 'right' | 'up') => void;
  isTop: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onSwipe, isTop }) => {
  const [isImageLoading, setIsImageLoading] = useState(true);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-25, 25]);
  const scale = useTransform(x, [-150, 0, 150], [1.05, 1, 1.05]);
  const opacity = useTransform(x, [-250, -200, 0, 200, 250], [0, 1, 1, 1, 0]);

  // 提取图片 URL 的辅助函数
  const getImageUrl = (product: any) => {
    // 优先从私有属性 _image_url 中读取 R2 永久链接
    const src = product._image_url || product['主图src'] || product.src || product['主图'] || product['图片'];
    
    if (!src) return '';
    
    // 如果 src 是对象，说明可能是 ExcelJS 提取时的原始引用，尝试取其文本
    if (typeof src === 'object' && src !== null) {
      return src.text || '';
    }
    
    const path = String(src).trim();
    
    // 支持 Vercel Blob 的 https 链接或本地路径
    if (path.startsWith('http')) {
      // 允许来自 Vercel Blob 的链接，或者是原本就有的远程图片链接
      return path;
    }
    
    return path;
  };

  // 处理价格显示的辅助函数
  const formatPrice = (price: any) => {
    if (price === undefined || price === null || String(price).trim() === '' || String(price) === 'undefined') {
      return 'N/A';
    }
    const p = String(price).trim();
    // 如果已经包含货币符号，直接返回
    if (p.includes('$') || p.includes('¥')) return p;
    // 否则默认加 ¥
    return `¥${p}`;
  };
  
  const originalTitle =
    String(
      getProductField(product, '商品标题') ||
        product['商品名'] ||
        product['Title'] ||
        product['title'] ||
        ''
    ).trim();

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.x > 100) {
      onSwipe('right');
    } else if (info.offset.x < -100) {
      onSwipe('left');
    } else if (info.offset.y < -100) {
      onSwipe('up');
    }
  };

  if (!isTop) {
    return (
      <div className="absolute inset-0 ios-card bg-white/40 ios-blur overflow-hidden scale-[0.98] translate-y-2" />
    );
  }

  return (
    <motion.div
      style={{ x, y, rotate, opacity, scale }}
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={handleDragEnd}
      className="absolute inset-0 ios-card bg-white/90 ios-blur overflow-hidden flex flex-col md:flex-row touch-none cursor-grab active:cursor-grabbing"
    >
      {/* 左侧/顶部：大图展示（略压缩高度，把空间让给信息区一屏显示） */}
      <div className="h-[34%] min-h-[120px] md:h-full md:w-[52%] md:min-h-0 bg-white relative p-1.5 md:p-3 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-gray-100/30 shrink-0">
        <div className="relative w-full h-full flex items-center justify-center">
          {isImageLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50/50 rounded-xl z-10">
              <Loader2 size={32} className="text-[#007AFF] animate-spin mb-2" />
              <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-widest">Loading Image...</span>
            </div>
          )}
          <img
            src={getImageUrl(product)}
            alt={product['商品标题']}
            className={`w-full h-full object-contain rounded-xl shadow-sm transition-opacity duration-300 ${isImageLoading ? 'opacity-0' : 'opacity-100'}`}
            draggable={false}
            referrerPolicy="no-referrer"
            onLoad={() => setIsImageLoading(false)}
            onError={(e) => {
              setIsImageLoading(false);
              const target = e.target as HTMLImageElement;
              target.src = 'https://placehold.co/600x600/F2F2F7/8E8E93?text=Image+Load+Failed';
            }}
          />
          {/* 调试信息层 */}
          <div className="absolute bottom-1 left-1 right-1 opacity-0 hover:opacity-100 transition-opacity bg-black/60 text-white p-1 rounded text-[7px] break-all pointer-events-none">
            Extracted: {getImageUrl(product)}
          </div>
        </div>
        {/* 滑动状态叠加层 */}
        <motion.div 
          style={{ opacity: useTransform(x, [40, 120], [0, 1]) }}
          className="absolute inset-0 bg-green-500/20 flex items-center justify-center"
        >
          <div className="bg-green-500 text-white p-4 rounded-full shadow-2xl scale-125 md:scale-150 ring-8 ring-green-500/20">
            <Heart size={32} fill="currentColor" />
          </div>
        </motion.div>
        <motion.div 
          style={{ opacity: useTransform(x, [-120, -40], [1, 0]) }}
          className="absolute inset-0 bg-red-500/20 flex items-center justify-center"
        >
          <div className="bg-red-500 text-white p-4 rounded-full shadow-2xl scale-125 md:scale-150 ring-8 ring-red-500/20">
            <X size={32} />
          </div>
        </motion.div>
      </div>

      {/* 右侧/底部：一屏内展示，禁用内部滚动 */}
      <div className="min-h-0 flex-1 md:h-full md:w-[48%] md:flex-none md:min-h-0 flex flex-col px-2 py-2 md:p-4 overflow-hidden">
        <div className="min-h-0 flex-1 flex flex-col justify-start gap-1.5 md:gap-2 overflow-hidden">
          {/* 原标题 + AI 摘要：始终顶对齐，避免桌面端垂直居中导致「上面空一块」 */}
          <div className="shrink-0 space-y-0.5">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">原标题</div>
            <p
              className={`text-[11px] md:text-sm font-semibold text-gray-800 leading-snug ${originalTitle ? 'line-clamp-3' : 'text-gray-300 italic'}`}
              title={originalTitle || undefined}
            >
              {originalTitle || '（无原标题）'}
            </p>
            <div className="flex flex-wrap gap-1">
              {getProductField(product, '中文商品名') && (
                <div className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] md:text-sm font-black bg-blue-50 text-blue-600 border border-blue-100/50 max-w-full">
                  <span className="truncate">{getProductField(product, '中文商品名')}</span>
                </div>
              )}
              {getProductField(product, '场景用途') && (
                <div className="inline-flex items-center px-1 py-0.5 rounded text-[9px] md:text-[10px] font-medium bg-purple-50 text-purple-600 border border-purple-100/50 max-w-full">
                  <span className="truncate">{getProductField(product, '场景用途')}</span>
                </div>
              )}
            </div>
          </div>

          {/* 类目 / 店铺：上移到价格上方，保证无需下滚即可看到 */}
          {(String(getProductField(product, '类目') || '').trim() !== '' ||
            String(getProductField(product, '商店名称') || '').trim() !== '') && (
            <div className="shrink-0 flex items-start gap-1.5 text-[10px] md:text-[11px] text-gray-500 leading-tight border-b border-gray-100/80 pb-1">
              <span className="shrink-0 font-bold text-gray-400">类目</span>
              <span className="min-w-0 flex-1 font-medium text-gray-600 line-clamp-2" title={String(getProductField(product, '类目') || '')}>
                {getProductField(product, '类目') || '—'}
              </span>
              <span className="shrink-0 truncate max-w-[38%] text-right text-gray-500" title={String(getProductField(product, '商店名称') || '')}>
                {getProductField(product, '商店名称')}
              </span>
            </div>
          )}

          <div className="bg-orange-50/40 px-2 py-1.5 md:p-2 rounded-lg border border-orange-100/50 flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <span className="text-orange-600 text-[8px] font-bold uppercase tracking-wider flex items-center gap-1">
                <ShoppingBag size={9} /> Price
              </span>
              <div className="font-black text-orange-700 text-base md:text-xl leading-none mt-0.5 truncate">
                {formatPrice(getProductField(product, '商品售价'))}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[8px] font-bold text-orange-600/60 uppercase">
                {Number(getProductField(product, '邮费')) === 0 ? 'Free Ship' : `+¥${getProductField(product, '邮费')}`}
              </div>
              <div className="text-[10px] font-semibold text-orange-700/80">
                ★{getProductField(product, '评分')}
              </div>
            </div>
          </div>

          {String(getProductField(product, '上架时间') || '').trim() !== '' && (
            <div className="shrink-0 flex items-center gap-1.5 bg-slate-50/90 px-2 py-1 rounded-lg border border-slate-100">
              <CalendarDays size={12} className="text-slate-500 shrink-0" />
              <span className="text-[8px] font-bold text-slate-400 uppercase shrink-0">上架</span>
              <span className="text-[11px] md:text-xs font-bold text-slate-800 truncate">
                {getProductField(product, '上架时间')}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5 min-h-0 shrink">
            <div className="bg-blue-50/40 px-1.5 py-1 md:p-2 rounded-lg border border-blue-100/50">
              <div className="text-blue-600 text-[7px] md:text-[8px] font-bold uppercase tracking-wide mb-0.5">7D</div>
              <div className="text-xs md:text-base font-black text-blue-700 truncate">{getProductField(product, '近7天销量')}</div>
            </div>
            <div className="bg-purple-50/40 px-1.5 py-1 md:p-2 rounded-lg border border-purple-100/50">
              <div className="text-purple-600 text-[7px] md:text-[8px] font-bold uppercase tracking-wide mb-0.5">Total</div>
              <div className="text-xs md:text-base font-black text-purple-700 truncate">{getProductField(product, '总销量')}</div>
            </div>
            <div className="bg-green-50/40 px-1.5 py-1 md:p-2 rounded-lg border border-green-100/50">
              <div className="text-green-600 text-[7px] md:text-[8px] font-bold uppercase tracking-wide mb-0.5">达人数</div>
              <div className="text-xs md:text-base font-black text-green-700 truncate">{getProductField(product, '关联达人')}</div>
            </div>
            <div className="bg-amber-50/50 px-1.5 py-1 md:p-2 rounded-lg border border-amber-100/60">
              <div className="text-amber-700/80 text-[7px] md:text-[8px] font-bold uppercase tracking-wide mb-0.5 flex items-center gap-0.5">
                <Video size={9} /> 视频
              </div>
              <div className="text-xs md:text-base font-black text-amber-900 truncate">{getProductField(product, '关联视频')}</div>
            </div>
          </div>

          {String(getProductField(product, '视频曝光量') || '').trim() !== '' && (
            <div className="shrink-0 flex items-center gap-1 text-[10px] text-gray-400">
              <Eye size={10} />
              <span className="truncate">曝光 {getProductField(product, '视频曝光量')}</span>
            </div>
          )}
        </div>

        <div className="shrink-0 flex gap-2 pt-2 pb-0.5">
          <button
            onClick={() => onSwipe('left')}
            className="flex-1 py-2 md:py-2.5 rounded-xl bg-gray-100 text-red-500 font-bold ios-button flex items-center justify-center gap-2 text-xs"
          >
            <X size={16} strokeWidth={3} /> Pass
          </button>
          <button
            onClick={() => onSwipe('right')}
            className="flex-1 py-2 md:py-2.5 rounded-xl bg-black text-white font-bold ios-button flex items-center justify-center gap-2 text-xs"
          >
            <Heart size={16} fill="currentColor" strokeWidth={3} /> Like
          </button>
        </div>
      </div>
    </motion.div>
  );
};
