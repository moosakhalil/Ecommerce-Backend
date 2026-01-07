const express = require('express');
const router = express.Router();
const Wallet = require('../models/Wallet');

// GET all wallets with search
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (search) {
      query = {
        $or: [
          { customerName: { $regex: search, $options: 'i' } },
          { customerPhone: { $regex: search, $options: 'i' } },
          { customerEmail: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const total = await Wallet.countDocuments(query);
    const wallets = await Wallet.find(query)
      .select('-transactions')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: wallets,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching wallets:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET wallet by customer ID
router.get('/customer/:customerId', async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ customerId: req.params.customerId });
    
    if (!wallet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Wallet not found for this customer' 
      });
    }

    res.json({ success: true, data: wallet });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET wallet by ID with full transaction history
router.get('/:id', async (req, res) => {
  try {
    const wallet = await Wallet.findById(req.params.id);
    
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    // Sort transactions by date (newest first)
    const walletData = wallet.toObject();
    walletData.transactions = walletData.transactions.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({ success: true, data: walletData });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create new wallet for customer
router.post('/', async (req, res) => {
  try {
    const { customerId, customerName, customerPhone, customerEmail, initialBalance = 0 } = req.body;

    if (!customerId || !customerName) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID and name are required'
      });
    }

    // Check if wallet already exists
    const existingWallet = await Wallet.findOne({ customerId });
    if (existingWallet) {
      return res.status(400).json({
        success: false,
        message: 'Wallet already exists for this customer'
      });
    }

    const wallet = new Wallet({
      customerId,
      customerName,
      customerPhone: customerPhone || '',
      customerEmail: customerEmail || '',
      balance: initialBalance,
      transactions: []
    });

    // If initial balance, create first transaction
    if (initialBalance > 0) {
      const transactionId = Wallet.generateTransactionId('CR');
      wallet.transactions.push({
        transactionId,
        type: 'credit',
        category: 'credit',
        amount: initialBalance,
        description: 'Initial wallet balance',
        performedBy: 'System'
      });
      wallet.totalCredits = initialBalance;
    }

    await wallet.save();
    res.status(201).json({ 
      success: true, 
      data: wallet, 
      message: 'Wallet created successfully' 
    });
  } catch (error) {
    console.error('Error creating wallet:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// POST add credit to wallet
router.post('/:id/credit', async (req, res) => {
  try {
    const { amount, description, category = 'credit', relatedOrderId, performedBy = 'Admin' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    if (!description) {
      return res.status(400).json({
        success: false,
        message: 'Description is required'
      });
    }

    const wallet = await Wallet.findById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    const transaction = await wallet.addCredit(amount, description, category, relatedOrderId, performedBy);

    res.json({
      success: true,
      data: {
        wallet,
        transaction
      },
      message: `Successfully added RP ${amount.toLocaleString()} to wallet`
    });
  } catch (error) {
    console.error('Error adding credit:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// POST deduct from wallet
router.post('/:id/debit', async (req, res) => {
  try {
    const { amount, description, category = 'order_payment', relatedOrderId, performedBy = 'Admin' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    if (!description) {
      return res.status(400).json({
        success: false,
        message: 'Description is required'
      });
    }

    const wallet = await Wallet.findById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    if (wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Current balance: RP ${wallet.balance.toLocaleString()}`
      });
    }

    const transaction = await wallet.deductBalance(amount, description, category, relatedOrderId, performedBy);

    res.json({
      success: true,
      data: {
        wallet,
        transaction
      },
      message: `Successfully deducted RP ${amount.toLocaleString()} from wallet`
    });
  } catch (error) {
    console.error('Error deducting balance:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// GET transaction history for a wallet
router.get('/:id/transactions', async (req, res) => {
  try {
    const { limit = 50, type } = req.query;
    
    const wallet = await Wallet.findById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    let transactions = wallet.transactions.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    if (type && ['credit', 'debit'].includes(type)) {
      transactions = transactions.filter(t => t.type === type);
    }

    res.json({
      success: true,
      data: transactions.slice(0, parseInt(limit)),
      balance: wallet.balance
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update wallet customer info
router.put('/:id', async (req, res) => {
  try {
    const { customerName, customerPhone, customerEmail, isActive } = req.body;

    const wallet = await Wallet.findById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    if (customerName) wallet.customerName = customerName;
    if (customerPhone !== undefined) wallet.customerPhone = customerPhone;
    if (customerEmail !== undefined) wallet.customerEmail = customerEmail;
    if (isActive !== undefined) wallet.isActive = isActive;

    await wallet.save();

    res.json({
      success: true,
      data: wallet,
      message: 'Wallet updated successfully'
    });
  } catch (error) {
    console.error('Error updating wallet:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE wallet (soft delete by deactivating)
router.delete('/:id', async (req, res) => {
  try {
    const wallet = await Wallet.findById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    wallet.isActive = false;
    await wallet.save();

    res.json({
      success: true,
      message: 'Wallet deactivated successfully'
    });
  } catch (error) {
    console.error('Error deactivating wallet:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
