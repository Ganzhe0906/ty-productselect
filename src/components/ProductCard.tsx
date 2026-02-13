'use client';

import React, { useState } from 'react';
import { motion, PanInfo, useMotionValue, useTransform } from 'framer-motion';
import { Product, getProductField } from '@/lib/excel';
import { Heart, X, ShoppingBag, Users, Eye, Loader2 } from 'lucide-react';

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
  
  // 处理百分比显示的辅助函数
  const formatPercent = (value: any) => {
    if (value === undefined || value === null || String(value).trim() === '' || String(value) === 'undefined') {
      return '0%';
    }
    const v = String(value).trim();
    // 如果已经包含百分号，直接返回，不再额外添加
    if (v.includes('%')) return v;
    // 否则添加百分号
    return `${v}%`;
  };

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
      {/* 左侧/顶部：大图展示 */}
      <div className="h-[40%] md:h-full md:w-[55%] bg-white relative p-2 md:p-4 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-gray-100/30">
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

      {/* 右侧/底部：紧凑信息区 */}
      <div className="h-[60%] md:h-full md:w-[45%] flex flex-col p-3 md:p-6 justify-between overflow-hidden">
        <div className="flex-1 flex flex-col justify-start md:justify-center space-y-2 md:space-y-5 overflow-y-auto pr-1 custom-scrollbar">
          {/* 标题与翻译 */}
          <div className="space-y-1">
            <h2 className="text-sm md:text-lg font-bold text-gray-900 tracking-tight leading-tight md:leading-snug line-clamp-2">
              {getProductField(product, '商品标题')}
            </h2>
            <div className="flex flex-wrap gap-1">
              {getProductField(product, '中文商品名') && (
                <div className="inline-flex items-center px-2 py-1 rounded-md text-sm md:text-base font-black bg-blue-50 text-blue-600 border border-blue-100/50">
                  {getProductField(product, '中文商品名')}
                </div>
              )}
              {getProductField(product, '场景用途') && (
                <div className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] md:text-[11px] font-medium bg-purple-50 text-purple-600 border border-purple-100/50">
                  {getProductField(product, '场景用途')}
                </div>
              )}
            </div>
          </div>

          {/* 核心指标 - 突出价格 */}
          <div className="bg-orange-50/40 p-2 md:p-3 rounded-xl border border-orange-100/50 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-orange-600 text-[8px] md:text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                <ShoppingBag size={10} /> Current Price
              </span>
              <div className="font-black text-orange-700 text-lg md:text-2xl leading-none mt-0.5">
                {formatPrice(getProductField(product, '商品售价'))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[8px] md:text-[9px] font-bold text-orange-600/60 uppercase">
                {Number(getProductField(product, '邮费')) === 0 ? 'Free Shipping' : `+ ¥${getProductField(product, '邮费')} Shipping`}
              </div>
              <div className="text-[10px] md:text-xs font-semibold text-orange-700/80 mt-0.5">
                Rating: {getProductField(product, '评分')}
              </div>
            </div>
          </div>

          {/* 核心指标网格 - 更加紧凑 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50/40 p-2 md:p-2.5 rounded-xl border border-blue-100/50">
              <div className="text-blue-600 text-[8px] md:text-[9px] font-bold uppercase tracking-wider mb-0.5">7D Sales</div>
              <div className="text-sm md:text-lg font-black text-blue-700">{getProductField(product, '近7天销量')}</div>
            </div>
            
            <div className="bg-purple-50/40 p-2 md:p-2.5 rounded-xl border border-purple-100/50">
              <div className="text-purple-600 text-[8px] md:text-[9px] font-bold uppercase tracking-wider mb-0.5">Total Sales</div>
              <div className="text-sm md:text-lg font-black text-purple-700">{getProductField(product, '总销量')}</div>
            </div>

            <div className="bg-green-50/40 p-2 md:p-2.5 rounded-xl border border-green-100/50">
              <div className="text-green-600 text-[8px] md:text-[9px] font-bold uppercase tracking-wider mb-0.5">Influencers</div>
              <div className="text-sm md:text-lg font-black text-green-700">{getProductField(product, '关联达人')}</div>
            </div>

            <div className="bg-gray-50/60 p-2 md:p-2.5 rounded-xl border border-gray-100">
              <div className="text-gray-500 text-[8px] md:text-[9px] font-bold uppercase tracking-wider mb-0.5">Conversion</div>
              <div className="text-sm md:text-lg font-black text-gray-700">{formatPercent(getProductField(product, '达人出单率'))}</div>
            </div>
          </div>

          {/* 次要信息 - 单行紧凑 */}
          <div className="flex items-center justify-between text-[10px] md:text-xs text-gray-400 pt-1 border-t border-gray-100/50">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><Eye size={10} /> {getProductField(product, '视频曝光量')}</span>
              <span className="flex items-center gap-1"><Users size={10} /> {getProductField(product, '关联视频')}</span>
            </div>
            <span className="truncate max-w-[100px] md:max-w-[150px] font-medium">{getProductField(product, '商店名称')}</span>
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="flex gap-2 md:gap-3 pt-3">
          <button 
            onClick={() => onSwipe('left')}
            className="flex-1 py-2 md:py-3 rounded-xl bg-gray-100 text-red-500 font-bold ios-button flex items-center justify-center gap-2 text-xs md:text-sm"
          >
            <X size={16} strokeWidth={3} /> Pass
          </button>
          <button 
            onClick={() => onSwipe('right')}
            className="flex-1 py-2 md:py-3 rounded-xl bg-black text-white font-bold ios-button flex items-center justify-center gap-2 text-xs md:text-sm"
          >
            <Heart size={16} fill="currentColor" strokeWidth={3} /> Like
          </button>
        </div>
      </div>
    </motion.div>
  );
};
