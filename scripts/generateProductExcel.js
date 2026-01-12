/**
 * Generate Excel File for Product Bulk Upload
 * 
 * Creates an Excel file with all 137 products including 2 parent products
 */

const XLSX = require('xlsx');
const path = require('path');

// ============================================================================
// PRODUCT DATA
// ============================================================================

const products = [];

// Helper to add product
function addProduct(data) {
  products.push(data);
}

// ============================================================================
// PARENT PRODUCTS (Added first so they get P0001 and P0002 IDs)
// ============================================================================

// Parent 1: Paint Collection
addProduct({
  productType: 'Parent',
  productName: 'Paint Collection',
  subtitle: 'Complete paint collection for all applications',
  brand: 'Multiple Brands',
  description: 'Parent product for all paint categories including water based, oil based, and special paints. Browse our wide selection of premium quality paints.',
  categories: 'Paint',
  subCategories: 'All Types',
  NormalPrice: 0,
  Stock: 0,
  globalTradeItemNumber: '8990001000001',
  packageSize: 'Small',
  visibility: 'Public',
  tags: 'Paint,Parent',
  height: 0,
  length: 0,
  width: 0,
  weight: 0,
  colours: '',
  imageFolder: '',
  masterImage: '',
  moreImages: '',
  parentProduct: '',
  varianceName: '',
  subtitleDescription: '',
  noChildHideParent: 'true'
});

// Parent 2: Decoration Collection
addProduct({
  productType: 'Parent',
  productName: 'Decoration Collection',
  subtitle: 'Complete decoration collection for home and office',
  brand: 'Multiple Brands',
  description: 'Parent product for all decoration categories including functional, visual, and natural decorations. Transform your space with our curated collection.',
  categories: 'Decoration',
  subCategories: 'All Types',
  NormalPrice: 0,
  Stock: 0,
  globalTradeItemNumber: '8990002000001',
  packageSize: 'Small',
  visibility: 'Public',
  tags: 'Decoration,Parent',
  height: 0,
  length: 0,
  width: 0,
  weight: 0,
  colours: '',
  imageFolder: '',
  masterImage: '',
  moreImages: '',
  parentProduct: '',
  varianceName: '',
  subtitleDescription: '',
  noChildHideParent: 'true'
});

// ============================================================================
// CONSTRUCTION MATERIAL (50 products)
// ============================================================================

// ----- CEMENT (10 products) -----
const cementData = [
  { name: 'Portland Cement Type I 50kg', subtitle: 'Premium grade Portland cement for general construction', brand: 'Tiga Roda', weight: 50, colours: 'Gray', price: 95000, stock: 500, height: 60, length: 40, width: 15 },
  { name: 'Portland Cement Type II 40kg', subtitle: 'Moderate sulfate resistant cement for concrete work', brand: 'Holcim', weight: 40, colours: 'Gray', price: 90000, stock: 350, height: 55, length: 38, width: 14 },
  { name: 'White Cement 40kg', subtitle: 'Premium white cement for decorative finishing', brand: 'Tiga Roda', weight: 40, colours: 'White', price: 125000, stock: 200, height: 55, length: 38, width: 14 },
  { name: 'Rapid Setting Cement 25kg', subtitle: 'Fast-setting cement for quick repairs and patching', brand: 'Semen Indonesia', weight: 25, colours: 'Gray', price: 95000, stock: 150, height: 45, length: 35, width: 12 },
  { name: 'PPC Cement 50kg', subtitle: 'Portland pozzolana cement eco-friendly option', brand: 'Semen Gresik', weight: 50, colours: 'Gray', price: 85000, stock: 600, height: 60, length: 40, width: 15 },
  { name: 'Slag Cement 50kg', subtitle: 'Blast furnace slag cement for marine structures', brand: 'Holcim', weight: 50, colours: 'Gray', price: 88000, stock: 300, height: 60, length: 40, width: 15 },
  { name: 'Sulfate Resistant Cement 40kg', subtitle: 'High resistance cement for harsh environments', brand: 'Semen Padang', weight: 40, colours: 'Gray', price: 110000, stock: 180, height: 55, length: 38, width: 14 },
  { name: 'Low Heat Cement 50kg', subtitle: 'Low heat of hydration for mass concrete', brand: 'Semen Indonesia', weight: 50, colours: 'Gray', price: 105000, stock: 220, height: 60, length: 40, width: 15 },
  { name: 'Masonry Cement 40kg', subtitle: 'Specialized cement for mortar and plastering', brand: 'Tiga Roda', weight: 40, colours: 'Gray', price: 78000, stock: 400, height: 55, length: 38, width: 14 },
  { name: 'High Alumina Cement 25kg', subtitle: 'Refractory cement for high temperature areas', brand: 'Semen Cibinong', weight: 25, colours: 'Brown', price: 185000, stock: 80, height: 45, length: 35, width: 12 },
];
cementData.forEach((p, i) => addProduct({
  productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Construction Material', subCategories: 'Cement', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899100100${String(i+1).padStart(4,'0')}`,
  packageSize: 'Large', visibility: 'Public', tags: 'Construction,Popular', height: p.height, length: p.length, width: p.width, weight: p.weight, colours: p.colours,
  imageFolder: 'construction/cement', masterImage: `cement_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: '', parentProduct: '', varianceName: '', subtitleDescription: ''
}));

// ----- BRICKS (10 products) -----
const brickData = [
  { name: 'Red Clay Brick Standard', subtitle: 'Traditional red clay brick for wall construction', brand: 'Bata Merah', weight: 3, colours: 'Red', price: 1200, stock: 5000, height: 5, length: 20, width: 10 },
  { name: 'Hollow Brick 10cm', subtitle: 'Lightweight hollow brick for partition walls', brand: 'Mitra Brick', weight: 8, colours: 'Gray', price: 2500, stock: 3000, height: 10, length: 40, width: 20 },
  { name: 'Concrete Block 40x20x20', subtitle: 'Heavy-duty concrete block for foundations', brand: 'Indo Block', weight: 15, colours: 'Gray', price: 3500, stock: 2000, height: 20, length: 40, width: 20 },
  { name: 'Decorative Exposed Brick', subtitle: 'Exposed finish brick for modern wall designs', brand: 'Artisan Brick', weight: 2.5, colours: 'Red', price: 4500, stock: 1000, height: 5, length: 22, width: 10 },
  { name: 'Fire Brick Refractory', subtitle: 'Heat resistant brick for furnaces fireplaces', brand: 'FireTech', weight: 4, colours: 'Yellow', price: 8500, stock: 500, height: 6, length: 23, width: 11 },
  { name: 'AAC Block Lightweight', subtitle: 'Autoclaved aerated concrete lightweight block', brand: 'Hebel', weight: 7.5, colours: 'White', price: 12000, stock: 1500, height: 20, length: 60, width: 10 },
  { name: 'Fly Ash Brick', subtitle: 'Eco-friendly brick made from fly ash material', brand: 'GreenBrick', weight: 3, colours: 'Gray', price: 1500, stock: 4000, height: 5, length: 20, width: 10 },
  { name: 'Perforated Brick', subtitle: 'Ventilation brick for air circulation walls', brand: 'VentBrick', weight: 2.8, colours: 'Red', price: 2000, stock: 2500, height: 5, length: 20, width: 10 },
  { name: 'Engineering Brick', subtitle: 'High strength low absorption engineering brick', brand: 'ProBrick', weight: 3.2, colours: 'Blue', price: 3000, stock: 1800, height: 6, length: 21, width: 10 },
  { name: 'Glazed Brick Decorative', subtitle: 'Glazed finish decorative brick for facades', brand: 'Artisan Brick', weight: 3, colours: 'Mixed', price: 6500, stock: 800, height: 5, length: 22, width: 10 },
];
brickData.forEach((p, i) => addProduct({
  productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Construction Material', subCategories: 'Bricks', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899100200${String(i+1).padStart(4,'0')}`,
  packageSize: 'Large', visibility: 'Public', tags: 'Construction', height: p.height, length: p.length, width: p.width, weight: p.weight, colours: p.colours,
  imageFolder: 'construction/bricks', masterImage: `brick_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: '', parentProduct: '', varianceName: '', subtitleDescription: ''
}));

// ----- TILES (10 products) -----
const tileData = [
  { name: 'Ceramic Floor Tile 60x60', subtitle: 'Premium ceramic floor tile glossy finish', brand: 'Roman', weight: 15, colours: 'Beige', price: 75000, stock: 800 },
  { name: 'Porcelain Tile Premium', subtitle: 'High-quality porcelain tile for luxury spaces', brand: 'Platinum', weight: 18, colours: 'White', price: 125000, stock: 500 },
  { name: 'Granite Tile Natural', subtitle: 'Natural granite tile for elegant flooring', brand: 'Granito', weight: 22, colours: 'Black', price: 185000, stock: 300 },
  { name: 'Marble Tile Polished', subtitle: 'Polished marble tile for premium interiors', brand: 'Marmer Indo', weight: 20, colours: 'White', price: 250000, stock: 200 },
  { name: 'Mosaic Tile Pattern', subtitle: 'Decorative mosaic tile for walls and pools', brand: 'MosaicArt', weight: 5, colours: 'Mixed', price: 95000, stock: 600 },
  { name: 'Terracotta Tile Rustic', subtitle: 'Rustic terracotta tile for traditional look', brand: 'TerraCotta', weight: 12, colours: 'Brown', price: 65000, stock: 700 },
  { name: 'Vitrified Tile Glossy', subtitle: 'High gloss vitrified tile ultra smooth finish', brand: 'Kajaria', weight: 16, colours: 'Cream', price: 95000, stock: 550 },
  { name: 'Wall Tile Bathroom', subtitle: 'Water resistant wall tile for bathrooms', brand: 'Roman', weight: 8, colours: 'White', price: 55000, stock: 900 },
  { name: 'Outdoor Tile Anti-Slip', subtitle: 'Anti-slip outdoor tile for patios gardens', brand: 'Niro', weight: 14, colours: 'Gray', price: 85000, stock: 650 },
  { name: 'Designer Tile Modern', subtitle: 'Modern pattern designer tile for accents', brand: 'Platinum', weight: 12, colours: 'Mixed', price: 145000, stock: 400 },
];
tileData.forEach((p, i) => addProduct({
  productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Construction Material', subCategories: 'Tiles', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899100300${String(i+1).padStart(4,'0')}`,
  packageSize: 'Large', visibility: 'Public', tags: 'Construction', height: 1, length: 60, width: 60, weight: p.weight, colours: p.colours,
  imageFolder: 'construction/tiles', masterImage: `tile_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: '', parentProduct: '', varianceName: '', subtitleDescription: ''
}));

// ----- STONE (20 products) -----
const stoneData = [
  { name: 'River Stone Natural', subtitle: 'Natural river stone for landscaping gardens', brand: 'NatureStone', weight: 25, colours: 'Mixed', price: 45000, stock: 400 },
  { name: 'Coral Stone Block', subtitle: 'Coral stone block for tropical construction', brand: 'CoralTech', weight: 30, colours: 'White', price: 85000, stock: 250 },
  { name: 'Flagstone Paving', subtitle: 'Flat flagstone for walkways and patios', brand: 'StoneMaster', weight: 20, colours: 'Gray', price: 75000, stock: 350 },
  { name: 'Cobblestone Classic', subtitle: 'Classic cobblestone for driveways courtyards', brand: 'Heritage Stone', weight: 5, colours: 'Gray', price: 15000, stock: 800 },
  { name: 'Granite Slab Black', subtitle: 'Black granite slab for kitchen countertops', brand: 'Granito', weight: 50, colours: 'Black', price: 450000, stock: 100 },
  { name: 'Limestone Block', subtitle: 'Natural limestone block for building walls', brand: 'LimeTech', weight: 35, colours: 'Cream', price: 95000, stock: 280 },
  { name: 'Sandstone Natural', subtitle: 'Natural sandstone for cladding and paving', brand: 'SandStone Co', weight: 28, colours: 'Yellow', price: 65000, stock: 380 },
  { name: 'Slate Tile Gray', subtitle: 'Gray slate tile for roofing and flooring', brand: 'SlateMaster', weight: 15, colours: 'Gray', price: 125000, stock: 450 },
  { name: 'Quartzite Stone', subtitle: 'Durable quartzite stone for heavy traffic', brand: 'QuartzTech', weight: 22, colours: 'White', price: 185000, stock: 200 },
  { name: 'Basalt Paving Stone', subtitle: 'Volcanic basalt stone for outdoor paving', brand: 'VolcanStone', weight: 18, colours: 'Black', price: 95000, stock: 320 },
  { name: 'Travertine Tile', subtitle: 'Elegant travertine tile for luxury flooring', brand: 'TraverTile', weight: 16, colours: 'Beige', price: 165000, stock: 280 },
  { name: 'Onyx Stone Decorative', subtitle: 'Translucent onyx stone for decorative uses', brand: 'OnyxArt', weight: 12, colours: 'Green', price: 350000, stock: 80 },
  { name: 'Bluestone Paver', subtitle: 'Blue-gray stone paver for pool decks', brand: 'BlueStone', weight: 20, colours: 'Blue', price: 145000, stock: 220 },
  { name: 'Fieldstone Natural', subtitle: 'Irregular fieldstone for rustic walls', brand: 'FieldStone', weight: 15, colours: 'Mixed', price: 55000, stock: 500 },
  { name: 'Crushed Stone Aggregate', subtitle: 'Crushed stone for concrete and drainage', brand: 'AggregateCo', weight: 50, colours: 'Gray', price: 35000, stock: 600 },
  { name: 'Split Face Stone', subtitle: 'Split face stone for textured wall cladding', brand: 'SplitStone', weight: 18, colours: 'Brown', price: 115000, stock: 300 },
  { name: 'Ledge Stone Wall', subtitle: 'Stacked ledge stone for accent walls', brand: 'LedgeStone', weight: 25, colours: 'Mixed', price: 135000, stock: 250 },
  { name: 'Stepping Stone Round', subtitle: 'Round stepping stone for garden pathways', brand: 'GardenStone', weight: 8, colours: 'Gray', price: 25000, stock: 700 },
  { name: 'Coping Stone Pool', subtitle: 'Pool coping stone for swimming pool edges', brand: 'PoolStone', weight: 12, colours: 'White', price: 85000, stock: 350 },
  { name: 'Corner Stone Decorative', subtitle: 'Corner stone for building corners accents', brand: 'CornerTech', weight: 10, colours: 'Mixed', price: 65000, stock: 400 },
];
stoneData.forEach((p, i) => addProduct({
  productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Construction Material', subCategories: 'Stone', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899100400${String(i+1).padStart(4,'0')}`,
  packageSize: 'Large', visibility: 'Public', tags: 'Construction', height: 30, length: 40, width: 30, weight: p.weight, colours: p.colours,
  imageFolder: 'construction/stone', masterImage: `stone_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: '', parentProduct: '', varianceName: '', subtitleDescription: ''
}));

// ============================================================================
// ELECTRIC (25 products)
// ============================================================================

// ----- LAMPS (5 products) -----
const lampData = [
  { name: 'LED Bulb 12W Daylight', subtitle: 'Energy efficient LED bulb bright daylight', brand: 'Philips', weight: 0.1, colours: 'White', price: 35000, stock: 500 },
  { name: 'LED Bulb 18W Warm', subtitle: 'Warm white LED bulb for cozy ambiance', brand: 'Osram', weight: 0.12, colours: 'Warm White', price: 45000, stock: 400 },
  { name: 'Fluorescent Tube 36W', subtitle: 'Standard fluorescent tube for office lighting', brand: 'Philips', weight: 0.3, colours: 'White', price: 25000, stock: 600 },
  { name: 'Smart LED RGB Bulb', subtitle: 'WiFi smart LED with color changing RGB', brand: 'Xiaomi', weight: 0.15, colours: 'RGB', price: 125000, stock: 200 },
  { name: 'Energy Saver Bulb 23W', subtitle: 'CFL energy saving bulb for long life', brand: 'Panasonic', weight: 0.1, colours: 'White', price: 28000, stock: 450 },
];
lampData.forEach((p, i) => addProduct({
  productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Electric', subCategories: 'Lamps', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899200100${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Electric,Popular', height: 12, length: 6, width: 6, weight: p.weight, colours: p.colours,
  imageFolder: 'electric/lamps', masterImage: `lamp_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: '', parentProduct: '', varianceName: '', subtitleDescription: ''
}));

// ----- CABLES (5 products) -----
const cableData = [
  { name: 'NYM Cable 3x2.5mm 50m', subtitle: 'Indoor installation cable PVC insulated', brand: 'Supreme', weight: 8, colours: 'White', price: 850000, stock: 100 },
  { name: 'NYY Cable 4x6mm 100m', subtitle: 'Underground power cable armored type', brand: 'Eterna', weight: 25, colours: 'Black', price: 2500000, stock: 50 },
  { name: 'Flexible Cable 2x1.5mm', subtitle: 'Flexible cable for appliances extension', brand: 'Kitani', weight: 3, colours: 'White', price: 180000, stock: 200 },
  { name: 'NYAF Cable Single Core', subtitle: 'Single core flexible cable for panels', brand: 'Supreme', weight: 5, colours: 'Mixed', price: 350000, stock: 150 },
  { name: 'Coaxial Cable RG6 100m', subtitle: 'Coaxial cable for TV and CCTV signals', brand: 'Belden', weight: 6, colours: 'Black', price: 450000, stock: 120 },
];
cableData.forEach((p, i) => addProduct({
  productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Electric', subCategories: 'Cables', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899200200${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Electric', height: 30, length: 30, width: 30, weight: p.weight, colours: p.colours,
  imageFolder: 'electric/cables', masterImage: `cable_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: '', parentProduct: '', varianceName: '', subtitleDescription: ''
}));

// ----- ROOF LAMPS (5 products) -----
const roofLampData = [
  { name: 'LED Ceiling Light 12W Round', subtitle: 'Round LED ceiling light surface mount', brand: 'Philips', weight: 0.5, colours: 'White', price: 85000, stock: 300 },
  { name: 'LED Ceiling Light 18W Square', subtitle: 'Square LED ceiling light modern design', brand: 'Osram', weight: 0.6, colours: 'White', price: 125000, stock: 250 },
  { name: 'LED Downlight 7W Recessed', subtitle: 'Recessed LED downlight for false ceiling', brand: 'Philips', weight: 0.3, colours: 'White', price: 65000, stock: 400 },
  { name: 'LED Panel Light 40W 60x60', subtitle: 'LED panel light for office ceiling grids', brand: 'Opple', weight: 2.5, colours: 'White', price: 350000, stock: 150 },
  { name: 'Chandelier Modern LED', subtitle: 'Modern LED chandelier for living rooms', brand: 'Crystal', weight: 8, colours: 'Gold', price: 1250000, stock: 30 },
];
roofLampData.forEach((p, i) => addProduct({
  productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Electric', subCategories: 'Roof Lamps', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899200300${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Electric', height: 15, length: 30, width: 30, weight: p.weight, colours: p.colours,
  imageFolder: 'electric/roof_lamps', masterImage: `roof_lamp_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: '', parentProduct: '', varianceName: '', subtitleDescription: ''
}));

// ----- CCTV (10 products with multiple images) -----
const cctvData = [
  { name: 'CCTV Dome Camera 2MP', subtitle: 'Indoor dome camera HD resolution night vision', brand: 'Hikvision', weight: 0.3, colours: 'White', price: 350000, stock: 200, imgCount: 2 },
  { name: 'CCTV Bullet Camera 4MP', subtitle: 'Outdoor bullet camera weatherproof IP66', brand: 'Dahua', weight: 0.5, colours: 'White', price: 550000, stock: 150, imgCount: 3 },
  { name: 'CCTV PTZ Camera 5MP', subtitle: 'Pan tilt zoom camera 360 degree rotation', brand: 'Hikvision', weight: 1.2, colours: 'White', price: 2500000, stock: 50, imgCount: 5 },
  { name: 'CCTV DVR 8 Channel', subtitle: 'Digital video recorder supports 8 cameras', brand: 'Dahua', weight: 2, colours: 'Black', price: 1500000, stock: 80, imgCount: 7 },
  { name: 'CCTV NVR 16 Channel', subtitle: 'Network video recorder for IP cameras', brand: 'Hikvision', weight: 2.5, colours: 'Black', price: 2800000, stock: 40, imgCount: 2 },
  { name: 'CCTV IP Camera Wireless', subtitle: 'WiFi IP camera mobile app monitoring', brand: 'TP-Link', weight: 0.2, colours: 'White', price: 450000, stock: 180, imgCount: 3 },
  { name: 'CCTV Kit 4 Camera Set', subtitle: 'Complete 4 camera package with DVR cables', brand: 'Dahua', weight: 5, colours: 'White', price: 3500000, stock: 60, imgCount: 5 },
  { name: 'CCTV Kit 8 Camera Set', subtitle: 'Complete 8 camera package professional grade', brand: 'Hikvision', weight: 8, colours: 'White', price: 6500000, stock: 35, imgCount: 7 },
  { name: 'CCTV Monitor 19 inch', subtitle: 'LED monitor for CCTV surveillance viewing', brand: 'LG', weight: 3, colours: 'Black', price: 1800000, stock: 45, imgCount: 2 },
  { name: 'CCTV Hard Drive 2TB', subtitle: 'Surveillance hard drive optimized for 24/7', brand: 'Seagate', weight: 0.5, colours: 'Silver', price: 950000, stock: 100, imgCount: 3 },
];
cctvData.forEach((p, i) => {
  const moreImgs = [];
  for (let j = 2; j <= p.imgCount; j++) {
    moreImgs.push(`cctv_${String(i+1).padStart(3,'0')}_${j}.jpg`);
  }
  addProduct({
    productType: 'Normal', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
    categories: 'Electric', subCategories: 'CCTV', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899200400${String(i+1).padStart(4,'0')}`,
    packageSize: 'Small', visibility: 'Public', tags: 'Electric,Security', height: 10, length: 15, width: 10, weight: p.weight, colours: p.colours,
    imageFolder: 'electric/cctv', masterImage: `cctv_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: moreImgs.join(','), parentProduct: '', varianceName: '', subtitleDescription: ''
  });
});

// ============================================================================
// PAINT (30 products - Child of P0001)
// ============================================================================

// ----- WATER BASED (10 products) -----
const waterPaintData = [
  { name: 'Acrylic Emulsion White 5L', subtitle: 'Premium acrylic paint smooth finish washable', brand: 'Dulux', weight: 7, colours: 'White', price: 285000, stock: 200 },
  { name: 'Acrylic Emulsion Cream 5L', subtitle: 'Cream colored acrylic paint interior walls', brand: 'Nippon', weight: 7, colours: 'Cream', price: 295000, stock: 180 },
  { name: 'Latex Paint Interior 5L', subtitle: 'Interior latex paint low odor easy clean', brand: 'Jotun', weight: 7, colours: 'White', price: 265000, stock: 220 },
  { name: 'Vinyl Matt Paint 5L', subtitle: 'Vinyl matt finish for ceilings and walls', brand: 'Dulux', weight: 7, colours: 'White', price: 245000, stock: 250 },
  { name: 'Silk Finish Paint 5L', subtitle: 'Silk sheen finish elegant appearance', brand: 'Nippon', weight: 7, colours: 'White', price: 325000, stock: 150 },
  { name: 'Weathershield Exterior 5L', subtitle: 'Weather resistant exterior paint durable', brand: 'Dulux', weight: 7.5, colours: 'White', price: 385000, stock: 180 },
  { name: 'Ceiling Paint White 5L', subtitle: 'Ultra white ceiling paint splatter free', brand: 'Jotun', weight: 6.5, colours: 'White', price: 225000, stock: 200 },
  { name: 'Primer Sealer Water 5L', subtitle: 'Water based primer sealer for bare walls', brand: 'Nippon', weight: 6, colours: 'White', price: 195000, stock: 180 },
  { name: 'Anti-Mold Paint 5L', subtitle: 'Mold resistant paint for humid areas', brand: 'Dulux', weight: 7, colours: 'White', price: 345000, stock: 120 },
  { name: 'Eco-Friendly Green 5L', subtitle: 'Low VOC eco-friendly paint safe home', brand: 'Jotun', weight: 7, colours: 'White', price: 365000, stock: 100 },
];
waterPaintData.forEach((p, i) => addProduct({
  productType: 'Child', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Paint', subCategories: 'Water Based', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899300100${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Paint', height: 25, length: 20, width: 20, weight: p.weight, colours: p.colours,
  parentProduct: 'P0001', varianceName: p.name, subtitleDescription: p.subtitle,
  imageFolder: 'paint/water_based', masterImage: `water_paint_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: ''
}));

// ----- OIL BASED (10 products) -----
const oilPaintData = [
  { name: 'Enamel Paint White 1L', subtitle: 'High gloss enamel paint for wood metal', brand: 'Avian', weight: 1.5, colours: 'White', price: 85000, stock: 300 },
  { name: 'Enamel Paint Black 1L', subtitle: 'Deep black enamel paint glossy finish', brand: 'Avian', weight: 1.5, colours: 'Black', price: 85000, stock: 280 },
  { name: 'Wood Varnish Clear 1L', subtitle: 'Clear wood varnish protective coating', brand: 'Propan', weight: 1.3, colours: 'Clear', price: 95000, stock: 250 },
  { name: 'Wood Stain Mahogany 1L', subtitle: 'Mahogany wood stain rich color finish', brand: 'Mowilex', weight: 1.3, colours: 'Mahogany', price: 105000, stock: 200 },
  { name: 'Metal Primer Red Oxide 1L', subtitle: 'Red oxide primer for metal protection', brand: 'Avian', weight: 1.5, colours: 'Red', price: 75000, stock: 350 },
  { name: 'Gloss Paint High Shine 1L', subtitle: 'Ultra high gloss paint mirror finish', brand: 'Nippon', weight: 1.5, colours: 'White', price: 125000, stock: 180 },
  { name: 'Floor Paint Industrial 5L', subtitle: 'Industrial floor paint heavy duty traffic', brand: 'Jotun', weight: 8, colours: 'Gray', price: 485000, stock: 80 },
  { name: 'Marine Paint Boat 1L', subtitle: 'Marine grade paint for boats waterproof', brand: 'Hempel', weight: 1.5, colours: 'Blue', price: 185000, stock: 100 },
  { name: 'Alkyd Enamel Premium 1L', subtitle: 'Premium alkyd enamel durable finish', brand: 'Dulux', weight: 1.5, colours: 'White', price: 145000, stock: 150 },
  { name: 'Rust Preventive Paint 1L', subtitle: 'Anti-rust paint for iron and steel', brand: 'Avian', weight: 1.5, colours: 'Gray', price: 95000, stock: 220 },
];
oilPaintData.forEach((p, i) => addProduct({
  productType: 'Child', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Paint', subCategories: 'Oil Based', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899300200${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Paint', height: 15, length: 12, width: 12, weight: p.weight, colours: p.colours,
  parentProduct: 'P0001', varianceName: p.name, subtitleDescription: p.subtitle,
  imageFolder: 'paint/oil_based', masterImage: `oil_paint_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: ''
}));

// ----- SPECIAL (10 products) -----
const specialPaintData = [
  { name: 'Epoxy Floor Coating 5L', subtitle: 'Two component epoxy floor coating industrial', brand: 'Sika', weight: 8, colours: 'Gray', price: 650000, stock: 80 },
  { name: 'Textured Wall Paint 5L', subtitle: 'Textured finish paint for decorative walls', brand: 'Nippon', weight: 8, colours: 'White', price: 425000, stock: 100 },
  { name: 'Heat Resistant Paint 1L', subtitle: 'High temperature paint up to 600C', brand: 'Rust-Oleum', weight: 1.5, colours: 'Black', price: 185000, stock: 120 },
  { name: 'Anti-Bacterial Paint 5L', subtitle: 'Antibacterial paint for hospitals clinics', brand: 'Dulux', weight: 7, colours: 'White', price: 485000, stock: 80 },
  { name: 'Magnetic Paint Gray 1L', subtitle: 'Magnetic primer for magnetic walls', brand: 'MagPaint', weight: 2, colours: 'Gray', price: 285000, stock: 60 },
  { name: 'Chalkboard Paint Black 1L', subtitle: 'Chalkboard paint write on walls erasable', brand: 'Rust-Oleum', weight: 1.5, colours: 'Black', price: 165000, stock: 100 },
  { name: 'Glow in Dark Paint 500ml', subtitle: 'Phosphorescent paint glows in darkness', brand: 'GlowTech', weight: 0.8, colours: 'Green', price: 225000, stock: 80 },
  { name: 'Metallic Gold Paint 1L', subtitle: 'Premium metallic gold paint accents', brand: 'Nippon', weight: 1.5, colours: 'Gold', price: 245000, stock: 90 },
  { name: 'Spray Paint Assorted 400ml', subtitle: 'Aerosol spray paint quick dry multi-color', brand: 'Pylox', weight: 0.4, colours: 'Mixed', price: 45000, stock: 500 },
  { name: 'Waterproofing Paint 5L', subtitle: 'Waterproof coating for roofs and walls', brand: 'Aquaproof', weight: 7, colours: 'White', price: 385000, stock: 120 },
];
specialPaintData.forEach((p, i) => addProduct({
  productType: 'Child', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Paint', subCategories: 'Special', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899300300${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Paint,Special', height: 20, length: 15, width: 15, weight: p.weight, colours: p.colours,
  parentProduct: 'P0001', varianceName: p.name, subtitleDescription: p.subtitle,
  imageFolder: 'paint/special', masterImage: `special_paint_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: ''
}));

// ============================================================================
// DECORATION (30 products - Child of P0002)
// ============================================================================

// ----- FUNCTIONAL (10 products) -----
const funcDecorData = [
  { name: 'Wall Clock Modern', subtitle: 'Modern minimalist wall clock silent movement', brand: 'IKEA Style', weight: 0.8, colours: 'Black', price: 185000, stock: 150 },
  { name: 'Mirror Frame Decorative', subtitle: 'Decorative mirror ornate frame classic', brand: 'HomeDecor', weight: 5, colours: 'Gold', price: 450000, stock: 80 },
  { name: 'Coat Hook Wall Mount', subtitle: 'Wall mounted coat hook rack modern design', brand: 'IKEA Style', weight: 0.5, colours: 'Black', price: 125000, stock: 200 },
  { name: 'Key Holder Wooden', subtitle: 'Wooden key holder organizer wall mount', brand: 'WoodCraft', weight: 0.3, colours: 'Brown', price: 85000, stock: 250 },
  { name: 'Shelf Floating Wood', subtitle: 'Floating wall shelf minimalist wooden design', brand: 'IKEA Style', weight: 2, colours: 'Brown', price: 165000, stock: 180 },
  { name: 'Umbrella Stand Metal', subtitle: 'Metal umbrella stand holder for entryway', brand: 'HomeDecor', weight: 3, colours: 'Black', price: 225000, stock: 100 },
  { name: 'Magazine Rack Wire', subtitle: 'Wire magazine rack modern wall mounted', brand: 'IKEA Style', weight: 1, colours: 'Gold', price: 145000, stock: 150 },
  { name: 'Storage Box Decorative', subtitle: 'Decorative storage box woven material', brand: 'HomeDecor', weight: 0.5, colours: 'Beige', price: 95000, stock: 300 },
  { name: 'Towel Holder Brass', subtitle: 'Brass towel holder ring bathroom accessory', brand: 'BrassWare', weight: 0.4, colours: 'Gold', price: 175000, stock: 180 },
  { name: 'Candle Holder Set', subtitle: 'Decorative candle holder set of 3 metal', brand: 'HomeDecor', weight: 1.2, colours: 'Black', price: 195000, stock: 120 },
];
funcDecorData.forEach((p, i) => addProduct({
  productType: 'Child', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Decoration', subCategories: 'Functional', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899400100${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Decoration', height: 20, length: 25, width: 15, weight: p.weight, colours: p.colours,
  parentProduct: 'P0002', varianceName: p.name, subtitleDescription: p.subtitle,
  imageFolder: 'decoration/functional', masterImage: `func_decor_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: ''
}));

// ----- VISUAL (10 products) -----
const visualDecorData = [
  { name: 'Wall Art Canvas Abstract', subtitle: 'Abstract modern wall art canvas print', brand: 'ArtPrint', weight: 1.5, colours: 'Mixed', price: 285000, stock: 100 },
  { name: 'Photo Frame Set 5pcs', subtitle: 'Photo frame set gallery wall collection', brand: 'FrameIt', weight: 2, colours: 'White', price: 225000, stock: 150 },
  { name: 'Decorative Vase Ceramic', subtitle: 'Ceramic decorative vase modern minimalist', brand: 'CeramicArt', weight: 1.5, colours: 'White', price: 185000, stock: 120 },
  { name: 'Sculpture Modern Metal', subtitle: 'Modern metal sculpture abstract design', brand: 'MetalArt', weight: 2.5, colours: 'Silver', price: 450000, stock: 50 },
  { name: 'Wall Decal Sticker', subtitle: 'Vinyl wall decal decorative sticker tree', brand: 'StickerArt', weight: 0.1, colours: 'Black', price: 85000, stock: 300 },
  { name: 'Tapestry Wall Hanging', subtitle: 'Bohemian tapestry wall hanging fabric art', brand: 'BohoArt', weight: 0.8, colours: 'Mixed', price: 195000, stock: 100 },
  { name: 'Decorative Plate Display', subtitle: 'Decorative ceramic plate for wall display', brand: 'CeramicArt', weight: 0.5, colours: 'Blue', price: 145000, stock: 150 },
  { name: 'String Lights LED Warm', subtitle: 'LED string lights warm white fairy lights', brand: 'LightUp', weight: 0.3, colours: 'Warm', price: 65000, stock: 400 },
  { name: 'Neon Sign Custom', subtitle: 'LED neon sign decorative wall light', brand: 'NeonArt', weight: 1, colours: 'Pink', price: 385000, stock: 60 },
  { name: 'Wind Chimes Bamboo', subtitle: 'Bamboo wind chimes outdoor garden decor', brand: 'NatureDecor', weight: 0.4, colours: 'Brown', price: 125000, stock: 200 },
];
visualDecorData.forEach((p, i) => addProduct({
  productType: 'Child', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Decoration', subCategories: 'Visual', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899400200${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Decoration', height: 30, length: 40, width: 5, weight: p.weight, colours: p.colours,
  parentProduct: 'P0002', varianceName: p.name, subtitleDescription: p.subtitle,
  imageFolder: 'decoration/visual', masterImage: `visual_decor_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: ''
}));

// ----- NATURAL PLASTIC (10 products) -----
const naturalDecorData = [
  { name: 'Artificial Plant Monstera', subtitle: 'Artificial monstera plant potted realistic', brand: 'FakePlant', weight: 1.5, colours: 'Green', price: 225000, stock: 150 },
  { name: 'Plastic Flower Bouquet', subtitle: 'Plastic flower bouquet mixed colors silk', brand: 'SilkFlower', weight: 0.5, colours: 'Mixed', price: 85000, stock: 300 },
  { name: 'Fake Grass Mat', subtitle: 'Artificial grass mat for indoor outdoor', brand: 'GreenMat', weight: 2, colours: 'Green', price: 145000, stock: 200 },
  { name: 'Artificial Succulent Set', subtitle: 'Mini artificial succulent set of 6 pots', brand: 'FakePlant', weight: 0.8, colours: 'Green', price: 165000, stock: 180 },
  { name: 'Plastic Ivy Vine 2m', subtitle: 'Plastic ivy vine garland for wall decor', brand: 'GreenVine', weight: 0.3, colours: 'Green', price: 45000, stock: 500 },
  { name: 'Faux Tree Potted 1.5m', subtitle: 'Large faux tree potted realistic foliage', brand: 'FakePlant', weight: 5, colours: 'Green', price: 550000, stock: 50 },
  { name: 'Dried Flower Arrangement', subtitle: 'Natural dried flower bouquet preserved', brand: 'DriedFloral', weight: 0.3, colours: 'Mixed', price: 195000, stock: 120 },
  { name: 'Plastic Bonsai Tree', subtitle: 'Artificial bonsai tree Japanese style', brand: 'FakePlant', weight: 1, colours: 'Green', price: 285000, stock: 80 },
  { name: 'Artificial Moss Panel', subtitle: 'Preserved moss wall panel decor green', brand: 'MossWall', weight: 1.5, colours: 'Green', price: 325000, stock: 60 },
  { name: 'Fake Orchid White', subtitle: 'Artificial white orchid in ceramic pot', brand: 'SilkFlower', weight: 0.8, colours: 'White', price: 175000, stock: 150 },
];
naturalDecorData.forEach((p, i) => addProduct({
  productType: 'Child', productName: p.name, subtitle: p.subtitle, brand: p.brand, description: `${p.name}. ${p.subtitle}. High quality product from ${p.brand}.`,
  categories: 'Decoration', subCategories: 'Natural Plastic', NormalPrice: p.price, Stock: p.stock, globalTradeItemNumber: `899400300${String(i+1).padStart(4,'0')}`,
  packageSize: 'Small', visibility: 'Public', tags: 'Decoration,Natural', height: 40, length: 25, width: 25, weight: p.weight, colours: p.colours,
  parentProduct: 'P0002', varianceName: p.name, subtitleDescription: p.subtitle,
  imageFolder: 'decoration/natural_plastic', masterImage: `natural_decor_${String(i+1).padStart(3,'0')}_main.jpg`, moreImages: ''
}));

// ============================================================================
// GENERATE EXCEL FILE
// ============================================================================

console.log('\n📊 Product Summary:');
console.log(`   Parent Products: 2`);
console.log(`   Normal Products: 75 (Construction: 50, Electric: 25)`);
console.log(`   Child Products: 60 (Paint: 30, Decoration: 30)`);
console.log(`   Total: ${products.length}`);

// Create workbook
const wb = XLSX.utils.book_new();

// Create worksheet from products
const ws = XLSX.utils.json_to_sheet(products);

// Set column widths
ws['!cols'] = [
  { wch: 10 }, { wch: 35 }, { wch: 50 }, { wch: 15 }, { wch: 60 },
  { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 8 }, { wch: 20 },
  { wch: 10 }, { wch: 10 }, { wch: 25 }, { wch: 8 }, { wch: 8 },
  { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 25 }, { wch: 35 },
  { wch: 60 }, { wch: 12 }, { wch: 35 }, { wch: 50 }, { wch: 10 }
];

// Add worksheet to workbook
XLSX.utils.book_append_sheet(wb, ws, 'Products');

// Write file
const outputPath = path.join(__dirname, '../data/products_import_new.xlsx');
XLSX.writeFile(wb, outputPath);

console.log(`\n✅ Excel file created: ${outputPath}`);
console.log('\n� Important Notes:');
console.log('   1. Parent products are listed FIRST (rows 2-3) to get P0001 and P0002 IDs');
console.log('   2. Child products reference P0001 (Paint) and P0002 (Decoration)');
console.log('   3. Images will be loaded from frontend/public/product-images/ folder');
console.log('   4. Upload this file via Admin Panel → Products → Upload Excel');
