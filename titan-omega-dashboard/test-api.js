/**
 * Test Polygon.io API Connection
 * 
 * Verifies:
 * 1. API key is valid
 * 2. Indices subscription works (I:SPX, I:VIX)
 * 3. Options Developer subscription works
 */

const API_KEY = 'FiCJ8PsfpVJdT8kActpoQhbQZtDq0zU6';
const BASE_URL = 'https://api.polygon.io';

async function testEndpoint(name, endpoint) {
  try {
    const url = `${BASE_URL}${endpoint}?apiKey=${API_KEY}`;
    console.log(`\n🔄 Testing: ${name}`);
    console.log(`   Endpoint: ${endpoint}`);
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (response.ok && data.status !== 'ERROR') {
      console.log(`   ✅ SUCCESS (${response.status})`);
      
      // Log relevant data
      if (data.results) {
        if (Array.isArray(data.results)) {
          console.log(`   📊 Results: ${data.results.length} items`);
          if (data.results[0]) {
            console.log(`   📊 First item:`, JSON.stringify(data.results[0], null, 2).slice(0, 200));
          }
        } else {
          console.log(`   📊 Results:`, JSON.stringify(data.results, null, 2).slice(0, 200));
        }
      } else if (data.market) {
        console.log(`   📊 Market: ${data.market}`);
      } else if (data.ticker) {
        console.log(`   📊 Ticker:`, JSON.stringify(data.ticker, null, 2).slice(0, 200));
      }
      return true;
    } else {
      console.log(`   ❌ FAILED (${response.status}): ${data.error || data.message || 'Unknown error'}`);
      return false;
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    return false;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   POLYGON.IO API TEST - Indices + Options Developer');
  console.log('═══════════════════════════════════════════════════════════');
  
  const results = {};
  
  // 1. Market Status (Basic - all plans)
  results.marketStatus = await testEndpoint(
    'Market Status',
    '/v1/marketstatus/now'
  );
  
  // 2. SPX Index Snapshot (Indices subscription)
  results.spxSnapshot = await testEndpoint(
    'SPX Index Snapshot (Indices)',
    '/v3/snapshot/indices?ticker.any_of=I:SPX'
  );
  
  // 3. SPX Previous Day (Indices subscription)
  results.spxPrev = await testEndpoint(
    'SPX Previous Day (Indices)',
    '/v2/aggs/ticker/I:SPX/prev'
  );
  
  // 4. VIX Index Snapshot (Indices subscription)
  results.vixSnapshot = await testEndpoint(
    'VIX Index Snapshot (Indices)',
    '/v3/snapshot/indices?ticker.any_of=I:VIX'
  );
  
  // 5. VIX Previous Day (Indices subscription)
  results.vixPrev = await testEndpoint(
    'VIX Previous Day (Indices)',
    '/v2/aggs/ticker/I:VIX/prev'
  );
  
  // 6. SPX Intraday Bars (Indices subscription)
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  results.spxBars = await testEndpoint(
    'SPX Intraday Bars (Indices)',
    `/v2/aggs/ticker/I:SPX/range/5/minute/${weekAgo}/${today}?limit=100`
  );
  
  // 7. SPY Options Chain (Options Developer subscription)
  results.spyOptions = await testEndpoint(
    'SPY Options Chain (Options Developer)',
    '/v3/snapshot/options/SPY?limit=50'
  );
  
  // 8. SPX Options Chain (Options Developer subscription - may not be available)
  results.spxOptions = await testEndpoint(
    'SPX Options Chain (Options Developer)',
    '/v3/snapshot/options/SPX?limit=50'
  );
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('   TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  
  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;
  
  console.log(`\n   Results: ${passed}/${total} tests passed\n`);
  
  for (const [name, result] of Object.entries(results)) {
    console.log(`   ${result ? '✅' : '❌'} ${name}`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  
  if (results.spxSnapshot && results.vixSnapshot) {
    console.log('   ✅ INDICES SUBSCRIPTION: Working');
  } else {
    console.log('   ⚠️ INDICES SUBSCRIPTION: May need activation');
  }
  
  if (results.spyOptions || results.spxOptions) {
    console.log('   ✅ OPTIONS DEVELOPER: Working');
  } else {
    console.log('   ⚠️ OPTIONS DEVELOPER: May need activation');
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
}

runTests();
