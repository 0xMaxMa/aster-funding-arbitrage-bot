# AsterDEX Funding Rate Arbitrage Bot

**Aster Funding Rate Arbitrage - Scale in/out positions with low price spread**

บอทเทรด Funding Rate Arbitrage สำหรับ AsterDEX ที่ทำงานโดยเปิด Short Perpetual และ Buy Spot พร้อมกันเพื่อ farm funding rate โดยสามารถทยอยเปิด/ปิด position และรอ spread ที่ดีก่อน execute

## คุณสมบัติ

- **โหมด Open**: เปิด short perpetual + buy spot พร้อมกัน
- **โหมด Close**: ปิด short perpetual + sell spot พร้อมกัน
- **ตรวจสอบ spread**: รอให้ราคา perp และ spot ต่างกันน้อยกว่าที่กำหนดก่อนเปิด order
- **ทยอยซื้อ/ขาย**: แบ่ง order เป็น lot เล็กๆ เพื่อลด slippage
- **Emergency close**: ปิด position อัตโนมัติเมื่อฝั่งใดฝั่งหนึ่งหมด

## การติดตั้ง

### 1. Clone Repository (ถ้ามี) หรือดาวน์โหลดโปรเจค

### 2. ติดตั้ง Dependencies
```bash
npm install
```

คำสั่งนี้จะติดตั้ง package ที่จำเป็น:
- `axios` - สำหรับเรียก API
- `dotenv` - สำหรับอ่านไฟล์ .env

### 3. สร้างไฟล์ `.env` จาก `.env.example`
```bash
cp .env.example .env
```

### 4. แก้ไขไฟล์ `.env` ใส่ API keys และ configuration
```env
# AsterDEX API (ใช้ร่วมกันทั้ง Futures และ Spot)
ASTERDEX_API_KEY=your_api_key_here
ASTERDEX_API_SECRET=your_api_secret_here

# API URLs
FUTURES_API_URL=https://fapi.asterdex.com
SPOT_API_URL=https://sapi.asterdex.com

# Trading Config
MAX_PRICE_DIFF_PERCENT=0.1
RETRY_DELAY_MS=5000
```

### 5. สร้าง API Keys จาก AsterDEX
- ไปที่ [AsterDEX](https://asterdex.com) → Settings → API Management
- สร้าง API key 1 ชุด (ใช้ได้ทั้ง Futures และ Spot)
- เปิดใช้งาน permissions: **Futures Trading** และ **Spot Trading**
- Copy API key และ Secret ไปใส่ในไฟล์ `.env`

⚠️ **คำเตือน**: อย่าแชร์ API Secret ให้ใครเห็น เก็บไฟล์ `.env` ไว้ในเครื่องของคุณเท่านั้น

### 6. ทดสอบการทำงาน
```bash
# ทดสอบด้วย position เล็กๆ ก่อน
npm run open ASTERUSDT 10 5
```

## การใช้งาน

### เปิด Position (Open Mode)
```bash
npm run open <SYMBOL> <TOTAL_SIZE_USD> <LOT_SIZE_USD>
```

ตัวอย่าง: เปิด short position $1000 และ buy spot $1000 โดยทยอยซื้อทีละ $10 USD
```bash
npm run open BTCUSDT 1000 10
```

### ปิด Position (Close Mode)
```bash
npm run close <SYMBOL> <CLOSE_PERCENT> <LOT_SIZE_PERCENT>
```

ตัวอย่าง: ปิด 100% ของ position ทั้งหมด โดยทยอยปิดทีละ 2%
```bash
npm run close ASTERUSDT 100 2
```

ตัวอย่าง: ปิด 50% ของ position ทั้งหมด โดยทยอยปิดทีละ 2%
```bash
npm run close ASTERUSDT 50 2
```

### Debug Mode
เพิ่ม flag `--debug` เพื่อแสดง debug logs:
```bash
npm run open BTCUSDT 1000 10 --debug
```

Debug mode จะแสดง:
- Quantity rounding details
- Order request parameters และ signature
- Order response จาก API
- Updated order status (ถ้ามีการเช็คซ้ำ)

## พารามิเตอร์

### โหมด Open
- **SYMBOL**: คู่เทรด เช่น BTCUSDT, ETHUSDT, ASTERUSDT
- **TOTAL_SIZE_USD**: ขนาด position รวมที่ต้องการเปิด (หน่วย USD)
- **LOT_SIZE_USD**: ขนาดของแต่ละ lot ที่จะทยอยเปิด (หน่วย USD)

**หน่วยเป็น USD** - บอทจะคำนวณ quantity ของเหรียญอัตโนมัติตามราคาปัจจุบัน

⚠️ **ข้อจำกัด**:
- **Minimum order size**: $5 USD ต่อ order
- ถ้า lot สุดท้ายมีขนาดน้อยกว่า $5 USD บอทจะรวมกับ lot ปัจจุบันอัตโนมัติ
- ถ้า balance ไม่พอ bot จะหยุดและแสดง summary

**ตัวอย่าง**:
- ✅ `TOTAL_SIZE_USD=20, LOT_SIZE_USD=5` → 4 lots ขนาด $5 แต่ละ lot
- ✅ `TOTAL_SIZE_USD=20, LOT_SIZE_USD=6` → 3 lots ($6 + $6 + $8) - lot สุดท้ายถูกรวมอัตโนมัติ

### โหมด Close
- **SYMBOL**: คู่เทรด เช่น ASTERUSDT
- **CLOSE_PERCENT**: เปอร์เซ็นต์ของ position ที่ต้องการปิด (0-100)
- **LOT_SIZE_PERCENT**: เปอร์เซ็นต์ของแต่ละ lot ที่จะทยอยปิด

**ใช้ Percentage แทน USD** - เพื่อให้ปิด position ทั้งสองฝั่งในอัตราส่วนเดียวกัน (hedge ratio คงเดิม)

⚠️ **ข้อจำกัด**:
- **Minimum order size**: $5 USD ต่อฝั่ง
- ถ้า lot แรกน้อยกว่า $5 USD → bot จะแนะนำให้เพิ่ม lotSizePercent
- ถ้า lot สุดท้ายน้อยกว่า $5 USD → bot จะปิดเท่าที่ทำได้และแจ้งเตือน

**ตัวอย่าง**:
- ✅ `CLOSE_PERCENT=100, LOT_SIZE_PERCENT=20` → ปิด 100% ในครั้งละ 20% = 5 lots
- ✅ `CLOSE_PERCENT=50, LOT_SIZE_PERCENT=10` → ปิด 50% ในครั้งละ 10% = 5 lots
- ❌ `CLOSE_PERCENT=100, LOT_SIZE_PERCENT=5` → ถ้า position เล็ก lot อาจน้อยกว่า $5

## Configuration (.env)

### API Configuration
- `ASTERDEX_API_KEY`: API key จาก AsterDEX (ใช้ร่วมกันทั้ง Futures และ Spot)
- `ASTERDEX_API_SECRET`: API secret จาก AsterDEX
- `FUTURES_API_URL`: Futures API endpoint (default: `https://fapi.asterdex.com`)
- `SPOT_API_URL`: Spot API endpoint (default: `https://sapi.asterdex.com`)

### Trading Configuration
- `MAX_PRICE_DIFF_PERCENT`: % ต่างราคาสูงสุดที่ยอมรับระหว่าง futures และ spot (default: `0.1`)
  - ตัวอย่าง: `0.1` = ยอมรับต่างราคาได้สูงสุด 0.1%
- `RETRY_DELAY_MS`: เวลารอก่อนตรวจสอบ spread ใหม่ (milliseconds, default: `5000`)
  - ตัวอย่าง: `5000` = รอ 5 วินาทีก่อน retry
  - บอทจะ retry ไปเรื่อยๆ จนกว่าจะเจอ spread ที่ดี

## โครงสร้างโปรเจค

```
.
├── src/
│   ├── api/
│   │   ├── futures.js       # Futures API client
│   │   └── spot.js          # Spot API client
│   ├── strategies/
│   │   ├── openPosition.js  # เปิด position strategy
│   │   └── closePosition.js # ปิด position strategy
│   ├── utils/
│   │   └── priceChecker.js  # ตรวจสอบ spread
│   └── index.js             # Entry point
├── .env.example
├── package.json
└── README.md
```

## วิธีการทำงาน

### โหมด Open (เปิด Position)
1. บอทจะตรวจสอบ spread ระหว่าง futures และ spot
2. ถ้า spread มากกว่า `MAX_PRICE_DIFF_PERCENT` จะรอและ retry ต่อไปเรื่อยๆ
3. เมื่อเจอ spread ที่ดี จะเปิด market order ทั้งสองฝั่งพร้อมกัน:
   - Futures: เปิด SHORT
   - Spot: BUY
4. ทยอยเปิดทีละ lot ตาม `LOT_SIZE_USD` จนครบ `TOTAL_SIZE_USD`
5. แสดงสรุปผลรวมและราคาเฉลี่ย

### โหมด Close (ปิด Position)
1. **Fetch position ปัจจุบัน**: ดึงข้อมูล futures และ spot position
2. **คำนวณ target**: คำนวณ quantity ที่ต้องปิดตาม percentage
3. **รอ spread ที่ดี**: เหมือนโหมด open
4. **ทยอยปิดเป็น %**: ปิด market order ทั้งสองฝั่งพร้อมกันตาม lot percentage
   - Futures: ปิด SHORT (BUY)
   - Spot: SELL
   - รักษา hedge ratio เดิม (ไม่ว่า position จะเป็น 30/70 หรืออัตราส่วนใด ก็จะปิดในอัตราส่วนเดียวกัน)
5. **Smart handling**:
   - ถ้า lot แรกน้อยกว่า $5 → แจ้งเตือนให้เพิ่ม lot size
   - ถ้า lot สุดท้ายน้อยกว่า $5 → ปิด futures ด้วย reduceOnly, spot ต้องปิดเองใน UI
6. แสดงสรุปผลรวมและราคาเฉลี่ย

## คุณสมบัติเพิ่มเติม

### 📊 Progress Tracking
- แสดงหมายเลข lot ปัจจุบัน/ทั้งหมด (เช่น "Lot 1/4")
- แสดงค่า spread ที่พบและราคา futures/spot
- แสดงสรุปผลรวมและราคาเฉลี่ยเมื่อเสร็จสิ้น
- ใช้ emoji เพื่อให้อ่านง่าย (🟢 เปิด position, 🔴 ปิด position)

### 🔄 Auto Retry & Smart Order Handling
- รอ spread ที่ดีอัตโนมัติ (retry ไปเรื่อยๆ จนกว่าจะเจอ spread ตามที่ตั้งค่า)
- ตรวจสอบ order status หลังส่ง order 2 วินาที กรณี order ยังไม่ execute
- ข้าม lot ที่มีขนาดน้อยกว่า $5 USD อัตโนมัติเพื่อป้องกัน error

### 🔒 Emergency Close (โหมด Close เท่านั้น)
- ตรวจสอบ position ทั้งสองฝั่งก่อน execute แต่ละ lot
- ถ้าฝั่งใดฝั่งหนึ่งหมด (น้อยกว่า $1 USD) จะปิดอีกฝั่งทั้งหมดทันที

## หมายเหตุสำคัญ

⚠️ **การใช้งาน**
- บอทใช้ **Market Order** - ราคาอาจเปลี่ยนเล็กน้อยตอน execute
- หน่วยทั้งหมดเป็น **USD** - บอทจะคำนวณ quantity อัตโนมัติ
- บอทจะ **retry ไปเรื่อยๆ** จนกว่าจะเจอ spread ที่ดี (ไม่มีขีดจำกัด)
- **Minimum order size**: $5 USD (ต่ำกว่านี้จะถูก skip)

⚠️ **ความเสี่ยง**
- ต้องมี balance เพียงพอทั้ง Futures (margin) และ Spot
- ตรวจสอบ API permissions ให้รองรับ Futures และ Spot trading
- ควรทดสอบด้วย amount น้อยๆ ก่อน ($5-$20 USD)
- ตรวจสอบ position ใน AsterDEX หลังจาก execute เสร็จ

💡 **เคล็ดลับ**
- ตั้งค่า `MAX_PRICE_DIFF_PERCENT` ให้เหมาะสมกับความ volatile ของแต่ละเหรียญ
- เหรียญที่มี volume สูง แนะนำ `0.05-0.1%`
- เหรียญที่มี volume ต่ำ อาจต้องตั้ง `0.2-0.5%`
- ปรับ `RETRY_DELAY_MS` ตามความถี่ที่ต้องการตรวจสอบราคา
- ตั้ง `TOTAL_SIZE_USD` ให้หารลงตัวกับ `LOT_SIZE_USD` เพื่อไม่ให้เหลือ lot ที่น้อยกว่า $5 USD
- ใช้ `--debug` flag เพื่อดู debug logs เมื่อเจอปัญหา
