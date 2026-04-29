/**
 * DeepSeek API 连接测试脚本
 * 
 * 使用方法:
 * node test-deepseek-api.js
 */

const https = require('https');

// 配置 - 请替换为您的实际配置
const CONFIG = {
  apiKey: 'YOUR_API_KEY_HERE', // 替换为您的 DeepSeek API Key
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  timeout: 10000, // 10秒超时
};

console.log('='.repeat(60));
console.log('DeepSeek API 连接测试');
console.log('='.repeat(60));
console.log();

// 测试1: 检查网络连通性
function testNetworkConnectivity() {
  return new Promise((resolve, reject) => {
    console.log('[测试 1/3] 检查网络连通性...');
    const url = new URL(CONFIG.baseUrl);
    
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: '/',
      method: 'GET',
      timeout: CONFIG.timeout,
    }, (res) => {
      console.log(`✓ 网络连通正常 (HTTP ${res.statusCode})`);
      console.log();
      resolve(true);
    });
    
    req.on('error', (error) => {
      console.error(`✗ 网络连接失败: ${error.message}`);
      console.log();
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.error('✗ 网络连接超时');
      console.log();
      reject(new Error('Timeout'));
    });
    
    req.end();
  });
}

// 测试2: 检查API端点可达性
function testApiEndpoint() {
  return new Promise((resolve, reject) => {
    console.log('[测试 2/3] 检查API端点可达性...');
    
    const data = JSON.stringify({
      model: CONFIG.model,
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 5,
    });
    
    const url = new URL(`${CONFIG.baseUrl}/chat/completions`);
    
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      timeout: CONFIG.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
    }, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`✓ API端点可达 (HTTP ${res.statusCode})`);
          console.log();
          resolve(true);
        } else {
          console.error(`✗ API返回错误 (HTTP ${res.statusCode})`);
          try {
            const error = JSON.parse(body);
            console.error(`  错误信息: ${error.error?.message || body}`);
          } catch {
            console.error(`  响应内容: ${body.substring(0, 200)}`);
          }
          console.log();
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`✗ API请求失败: ${error.message}`);
      console.log();
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.error('✗ API请求超时');
      console.log();
      reject(new Error('Timeout'));
    });
    
    req.write(data);
    req.end();
  });
}

// 测试3: 完整的功能测试
function testFullFunctionality() {
  return new Promise((resolve, reject) => {
    console.log('[测试 3/3] 完整功能测试...');
    
    const data = JSON.stringify({
      model: CONFIG.model,
      messages: [
        { 
          role: 'system', 
          content: '你是一位书评人。请生成一段50-60字的微评。' 
        },
        { 
          role: 'user', 
          content: '书籍：《活着》\n作者：余华' 
        }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });
    
    const url = new URL(`${CONFIG.baseUrl}/chat/completions`);
    
    const startTime = Date.now();
    
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      timeout: CONFIG.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${CONFIG.apiKey}`,
      },
    }, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        const duration = Date.now() - startTime;
        
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(body);
            const content = response.choices?.[0]?.message?.content;
            
            console.log(`✓ API功能正常 (耗时: ${duration}ms)`);
            console.log();
            console.log('生成的微评:');
            console.log('-'.repeat(60));
            console.log(content);
            console.log('-'.repeat(60));
            console.log();
            console.log(`字数统计: ${content.length} 字符`);
            console.log();
            resolve(true);
          } catch (error) {
            console.error(`✗ 解析响应失败: ${error.message}`);
            console.log();
            reject(error);
          }
        } else {
          console.error(`✗ API调用失败 (HTTP ${res.statusCode}, 耗时: ${duration}ms)`);
          try {
            const error = JSON.parse(body);
            console.error(`  错误信息: ${error.error?.message || body}`);
          } catch {
            console.error(`  响应内容: ${body.substring(0, 200)}`);
          }
          console.log();
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`✗ API请求失败: ${error.message}`);
      console.log();
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.error(`✗ API请求超时 (>${CONFIG.timeout}ms)`);
      console.log();
      reject(new Error('Timeout'));
    });
    
    req.write(data);
    req.end();
  });
}

// 运行所有测试
async function runTests() {
  const results = {
    network: false,
    endpoint: false,
    functionality: false,
  };
  
  try {
    await testNetworkConnectivity();
    results.network = true;
  } catch (error) {
    console.error('网络测试失败，跳过后续测试\n');
    printSummary(results);
    process.exit(1);
  }
  
  try {
    await testApiEndpoint();
    results.endpoint = true;
  } catch (error) {
    console.error('API端点测试失败\n');
    printSummary(results);
    process.exit(1);
  }
  
  try {
    await testFullFunctionality();
    results.functionality = true;
  } catch (error) {
    console.error('功能测试失败\n');
  }
  
  printSummary(results);
}

// 打印测试总结
function printSummary(results) {
  console.log('='.repeat(60));
  console.log('测试总结');
  console.log('='.repeat(60));
  console.log(`网络连通性:   ${results.network ? '✓ 通过' : '✗ 失败'}`);
  console.log(`API端点可达:  ${results.endpoint ? '✓ 通过' : '✗ 失败'}`);
  console.log(`功能完整性:  ${results.functionality ? '✓ 通过' : '✗ 失败'}`);
  console.log('='.repeat(60));
  
  if (results.functionality) {
    console.log('\n✓ 所有测试通过！DeepSeek API 连接正常。');
  } else if (results.endpoint) {
    console.log('\n⚠ API端点可达，但功能测试失败。请检查API Key和模型配置。');
  } else {
    console.log('\n✗ 测试失败。请检查网络连接和API配置。');
  }
  console.log();
}

// 检查配置
if (CONFIG.apiKey === 'YOUR_API_KEY_HERE') {
  console.error('错误: 请先在文件中配置您的 DeepSeek API Key!');
  console.error('找到这一行: const apiKey = "YOUR_API_KEY_HERE"');
  console.error('替换为您的实际 API Key');
  console.log();
  process.exit(1);
}

// 执行测试
runTests().catch((error) => {
  console.error('测试执行出错:', error);
  process.exit(1);
});
