/**
 * Phase 6 Verification Test Suite
 * Tests AI Sales Agent, Function Tools Calling Loop, Inventory Checks, and Order Automation
 */

const http = require('http');
const app = require('../server');
const { setupTestDb, teardownTestDb } = require('./helpers/testDb');
const getOrderTool = require('../services/ai/tools/getOrder');
const createPaymentTool = require('../services/ai/tools/createPayment');
const { buildToolContext } = require('../services/ai/toolGuards');
const authService = require('../services/auth/authService');
const productService = require('../services/products/productService');

async function runTests() {
  console.log('=== Running Phase 6 Verification Tests ===');

  await setupTestDb();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Setup Seller & Catalog
    const sellerRes = await authService.register({
      businessName: 'Kiddies World NG',
      email: `kiddies_${Date.now()}@world.ng`,
      password: 'Password123!',
      phone: '+2348055551111',
    });
    const seller = sellerRes.seller;
    const token = sellerRes.token;

    const product = await productService.create(seller.id, {
      name: 'Baby Memory Foam Pillow',
      price: 8500,
      stock: 15,
      category: 'Baby Care',
      description: 'Soft ergonomic pillow for newborn sleep support',
    });

    const customerPhone = '+2348099887766';

    // 2. Greeting conversation
    console.log('Testing AI Greeting & Catalog Tool...');
    const resGreet = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sellerId: seller.id,
        customerPhone,
        body: 'Hello! What do you have in stock?',
      }),
    });
    const greetData = await resGreet.json();

    if (resGreet.status !== 200 || !greetData.toolCalls || greetData.toolCalls.length === 0) {
      throw new Error(`AI Greeting failed: ${JSON.stringify(greetData)}`);
    }
    if (!greetData.reply.includes('Baby Memory Foam Pillow')) {
      throw new Error(`AI reply did not include product from tool result: ${greetData.reply}`);
    }
    console.log('  [PASS] AI sales agent invoked searchProducts tool and presented catalog');

    // 3. Product Search and Price Check
    console.log('Testing AI Product Specific Search...');
    const resSearch = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sellerId: seller.id,
        customerPhone,
        body: 'How much is the Baby Memory Foam Pillow?',
      }),
    });
    const searchData = await resSearch.json();
    if (!searchData.reply.includes('8,500') || !searchData.reply.includes('in stock')) {
      throw new Error(`AI reply did not report authoritative price: ${searchData.reply}`);
    }
    console.log('  [PASS] AI verified authoritative price and stock level (₦8,500)');

    // 4. Order Initiation Intent with Address
    console.log('Testing AI Order Calculation Intent...');
    const resOrderIntent = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sellerId: seller.id,
        customerPhone,
        body: 'I want 2 units delivered to 14 Admiralty Way, Lekki Phase 1, Lagos',
      }),
    });
    const intentData = await resOrderIntent.json();
    if (!intentData.reply.includes('Order Summary') || !intentData.reply.includes('17,000')) {
      throw new Error(`AI order summary calculation failed: ${intentData.reply}`);
    }
    console.log('  [PASS] AI calculated subtotal and delivery fee, asking for confirmation');

    // 5. Order Confirmation (Customer confirms with "YES")
    console.log('Testing AI Order Placement Execution...');
    const resConfirm = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sellerId: seller.id,
        customerPhone,
        body: 'YES',
      }),
    });
    const confirmData = await resConfirm.json();
    if (!confirmData.orderId || !confirmData.reply.includes('Order Confirmed')) {
      throw new Error(`Order placement via AI failed: ${JSON.stringify(confirmData)}`);
    }
    console.log(`  [PASS] AI executed createOrder tool and generated Order #${confirmData.orderId}`);

    // 6. Payment Generation via AI
    console.log('Testing AI Paystack Payment Tool...');
    const resPay = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sellerId: seller.id,
        customerPhone,
        body: 'PAY',
      }),
    });
    const payData = await resPay.json();
    if (!payData.reply.includes('Payment link ready') || !payData.reply.includes('checkout.paystack.com')) {
      throw new Error(`AI payment creation failed: ${JSON.stringify(payData)}`);
    }
    console.log('  [PASS] AI executed createPayment tool and provided Paystack checkout link');

    // 7. Tool scoping: a store's agent must not expose one customer's order to another
    console.log('Testing AI tool ownership scoping...');
    const targetOrderId = confirmData.orderId;

    const ownerCtx = buildToolContext({ sellerId: seller.id, customerPhone });
    const ownerView = await getOrderTool.execute(seller.id, { orderId: targetOrderId }, ownerCtx);
    if (!ownerView || ownerView.id !== targetOrderId || !ownerView.deliveryAddress) {
      throw new Error(`Owner could not read their own order: ${JSON.stringify(ownerView)}`);
    }

    const strangerCtx = buildToolContext({ sellerId: seller.id, customerPhone: '+2348011112222' });
    let strangerBlocked = false;
    try {
      await getOrderTool.execute(seller.id, { orderId: targetOrderId }, strangerCtx);
    } catch (err) {
      strangerBlocked = /not found/i.test(err.message);
    }
    if (!strangerBlocked) {
      throw new Error("SECURITY: another customer of the same store read this order through the AI agent");
    }

    const anonCtx = buildToolContext({ sellerId: seller.id, customerPhone: 'anon_customer' });
    let anonBlocked = false;
    try {
      await getOrderTool.execute(seller.id, { orderId: targetOrderId }, anonCtx);
    } catch (err) {
      anonBlocked = /not found/i.test(err.message);
    }
    if (!anonBlocked) {
      throw new Error('SECURITY: an unidentified chat session read a customer order through the AI agent');
    }

    let strangerPaymentBlocked = false;
    try {
      await createPaymentTool.execute(seller.id, { orderId: targetOrderId }, strangerCtx);
    } catch (err) {
      strangerPaymentBlocked = /not found/i.test(err.message);
    }
    if (!strangerPaymentBlocked) {
      throw new Error("SECURITY: a stranger generated a payment link for someone else's order");
    }

    // The seller's own authenticated console legitimately sees tenant-wide data
    const sellerCtx = buildToolContext({ sellerId: seller.id, customerPhone: 'anon_customer', trusted: true });
    const sellerView = await getOrderTool.execute(seller.id, { orderId: targetOrderId }, sellerCtx);
    if (!sellerView || sellerView.id !== targetOrderId) {
      throw new Error('Seller console lost access to its own tenant order');
    }
    console.log('  [PASS] Order tools scoped to the conversation counterparty (stranger and anonymous blocked)');

    console.log('=== All Phase 6 Tests Passed Successfully! ===');
  } finally {
    server.close();
    await teardownTestDb();
  }
}

runTests().catch((err) => {
  console.error('Phase 6 Test Suite Failed:', err);
  process.exit(1);
});
