const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Island, LargerState, Regency, AreaB } = require('../models/AreaManagement');

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ecommerce';

async function seedAreas() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Read Excel file
    const excelPath = path.join(__dirname, '..', '..', 'areas .xlsx');
    console.log(`📄 Reading Excel file: ${excelPath}`);
    
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Found ${data.length} rows in Excel`);

    // Stats
    const stats = {
      islands: { created: 0, existing: 0 },
      states: { created: 0, existing: 0 },
      regencies: { created: 0, existing: 0 },
      areas: { created: 0, updated: 0, skipped: 0 }
    };

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      // Extract data (handle different column name cases)
      const islandName = (row['Island'] || row['island'] || '').toString().trim();
      const stateName = (row['larger state'] || row['Larger State'] || row['state'] || '').toString().trim();
      const regencyName = (row['Regency'] || row['regency'] || '').toString().trim();
      const areaName = (row['area'] || row['Area'] || '').toString().trim();
      const displayName = (row['Area name'] || row['area name'] || row['display name'] || '').toString().trim();
      const scooterPrice = Number(row['scooter price'] || row['Scooter Price'] || 0);
      const truckPrice = Number(row['truck price'] || row['Truck Price'] || 0);

      if (!islandName || !stateName || !regencyName || !areaName) {
        console.log(`⚠️ Row ${i + 2}: Missing required fields, skipping`);
        stats.areas.skipped++;
        continue;
      }

      try {
        // 1. Find or create Island
        let island = await Island.findOne({ name: { $regex: new RegExp(`^${islandName}$`, 'i') } });
        if (!island) {
          island = await Island.create({ name: islandName });
          stats.islands.created++;
          console.log(`🏝️ Created Island: ${islandName}`);
        } else {
          stats.islands.existing++;
        }

        // 2. Find or create LargerState
        let state = await LargerState.findOne({ 
          name: { $regex: new RegExp(`^${stateName}$`, 'i') },
          islandId: island._id 
        });
        if (!state) {
          state = await LargerState.create({ name: stateName, islandId: island._id });
          stats.states.created++;
          console.log(`  📍 Created State: ${stateName}`);
        } else {
          stats.states.existing++;
        }

        // 3. Find or create Regency
        let regency = await Regency.findOne({ 
          name: { $regex: new RegExp(`^${regencyName}$`, 'i') },
          largerStateId: state._id 
        });
        if (!regency) {
          regency = await Regency.create({ name: regencyName, largerStateId: state._id });
          stats.regencies.created++;
          console.log(`    🏘️ Created Regency: ${regencyName}`);
        } else {
          stats.regencies.existing++;
        }

        // 4. Find or create/update AreaB
        let area = await AreaB.findOne({ 
          name: { $regex: new RegExp(`^${areaName}$`, 'i') },
          regencyId: regency._id 
        });
        if (!area) {
          area = await AreaB.create({ 
            name: areaName, 
            displayName: displayName || areaName,
            regencyId: regency._id,
            scooterPrice,
            truckPrice
          });
          stats.areas.created++;
          console.log(`      ✅ Created Area: ${areaName} (Scooter: ${scooterPrice}, Truck: ${truckPrice})`);
        } else {
          // Update existing area with fees
          area.displayName = displayName || area.displayName;
          area.scooterPrice = scooterPrice;
          area.truckPrice = truckPrice;
          await area.save();
          stats.areas.updated++;
          console.log(`      🔄 Updated Area: ${areaName} (Scooter: ${scooterPrice}, Truck: ${truckPrice})`);
        }

      } catch (rowError) {
        console.error(`❌ Row ${i + 2} error:`, rowError.message);
        stats.areas.skipped++;
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(50));
    console.log(`🏝️ Islands:   ${stats.islands.created} created, ${stats.islands.existing} existing`);
    console.log(`📍 States:    ${stats.states.created} created, ${stats.states.existing} existing`);
    console.log(`🏘️ Regencies: ${stats.regencies.created} created, ${stats.regencies.existing} existing`);
    console.log(`📌 Areas:     ${stats.areas.created} created, ${stats.areas.updated} updated, ${stats.areas.skipped} skipped`);
    console.log('='.repeat(50));
    console.log('✅ Seeding completed successfully!');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the seeder
seedAreas()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
