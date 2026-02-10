import * as XLSX from 'xlsx';

export interface Product {
  // 核心显示字段（标准 Key）
  '主图src': string;
  '商品标题': string;
  '商品售价': string | number;
  '邮费': string | number;
  '类目': string;
  '评分': string | number;
  '商店名称': string;
  '店铺销量': string | number;
  '总销量': string | number;
  '近7天销量': string | number;
  '总销售额': string | number;
  '近7天销售额': string | number;
  '关联达人': string | number;
  '达人出单率': string | number;
  '关联视频': string | number;
  '视频曝光量': string | number;
  '中文商品名'?: string;
  '场景用途'?: string;
  
  [key: string]: any;
}

export const FIELD_ALIASES: Record<string, string[]> = {
  '商品标题': ['商品标题', '商品名', '标题', 'Name', 'Title'],
  '商品售价': ['商品售价', '最低售价', '售价', '价格', 'Price', 'Sale Price'],
  '邮费': ['邮费', '物流费用', '运费', 'Shipping'],
  '评分': ['评分', '商品评分', '店铺评分', 'Rating', 'Score'],
  '商店名称': ['商店名称', '店铺名', '店铺名称', 'Shop Name', 'Store Name'],
  '店铺销量': ['店铺销量', '店铺总销量', 'Shop Sales'],
  '近7天销量': ['近7天销量', '近 7 天销量', '7天销量', '7D Sales'],
  '近7天销售额': ['近7天销售额', '近 7 天销售额', '7天销售额', '7D Revenue'],
  '总销量': ['总销量', '销量', '累计销量', 'Total Sales'],
  '关联达人': ['关联达人', '达人数量', '达人', '关联达人数', 'Influencers', 'Creator Count'],
  '达人出单率': ['达人出单率', '出单率', '转化率', '达人转化率', 'Conversion', 'Conv %', 'CR%'],
  '关联视频': ['关联视频', '视频', '关联视频数', 'Videos'],
  '视频曝光量': ['视频曝光量', '曝光', '播放量', 'Views', 'Plays', 'Impressions'],
  '中文商品名': ['中文商品名', '中文标题', 'chinese_name'],
  '场景用途': ['场景用途', '使用场景', 'usage_scenario'],
};

export const getProductField = (product: Product, standardKey: string): any => {
  // 1. 直接尝试标准 Key
  if (product[standardKey] !== undefined && product[standardKey] !== null && String(product[standardKey]) !== 'undefined') {
    return product[standardKey];
  }

  // 2. 尝试别名
  const aliases = FIELD_ALIASES[standardKey] || [];
  for (const alias of aliases) {
    if (product[alias] !== undefined && product[alias] !== null && String(product[alias]) !== 'undefined') {
      return product[alias];
    }
  }

  // 3. 兜底：如果都没有，返回空
  return '';
};

export const exportToExcel = (products: Product[], fileName: string = 'liked_products.xlsx') => {
  const dataToExport = products.map(p => {
    const { ...cleanProduct } = p;
    // 移除所有辅助性质的 Key，只保留业务数据
    delete cleanProduct._index;
    return cleanProduct;
  });

  const worksheet = XLSX.utils.json_to_sheet(dataToExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Liked');
  XLSX.writeFile(workbook, fileName);
};
