const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const axios = require('axios'); // Using axios instead of paystack-api for more control
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

// Log environment variables for debugging
console.log('Environment variables:');
console.log('- PAYSTACK_SECRET_KEY:', process.env.PAYSTACK_SECRET_KEY ? 'Found' : 'Missing');
console.log('- MONGODB_URI:', process.env.MONGODB_URI ? 'Found' : 'Missing');
console.log('- EMAIL_USER:', process.env.EMAIL_USER ? 'Found' : 'Missing');
console.log('- EMAIL_PASS:', process.env.EMAIL_PASS ? 'Found' : 'Missing');

const app = express();

// MongoDB Connection URI
const uri = process.env.MONGODB_URI || "mongodb+srv://etuteehichioya:RweQq398UmIKPJGN@cluster0.h58jc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 30000, // 30 seconds timeout
  socketTimeoutMS: 45000, // 45 seconds socket timeout
});

// Global database variable
let db;

// Connect to MongoDB with retry logic
async function connectToMongoDB() {
  let retries = 5;
  while (retries) {
    try {
      console.log('Connecting to MongoDB...');
      await client.connect();
      console.log('Connected to MongoDB successfully');
      return client.db('raffle_draw');
    } catch (error) {
      console.error(`MongoDB connection attempt failed (${retries} retries left):`, error);
      retries--;
      if (retries > 0) {
        console.log('Retrying in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.error('Failed to connect to MongoDB after multiple attempts');
        throw error;
      }
    }
  }
}

// Initialize the database connection before starting the server
(async function initializeApp() {
  try {
    db = await connectToMongoDB();
    
    // Create necessary collections if they don't exist
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    if (!collectionNames.includes('tickets')) {
      await db.createCollection('tickets');
      console.log('Created tickets collection');
    }
    
    // Start server after DB connection is established
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
})();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

// Improved function to generate and verify unique ticket numbers
async function generateUniqueTicketNumbers(count) {
  const ticketNumbers = [];
  const ticketsCollection = db.collection('tickets');
  let attempts = 0;
  const maxAttempts = count * 3; // Set a reasonable limit on attempts to prevent infinite loops
  
  console.log(`Generating ${count} unique ticket numbers...`);
  
  while (ticketNumbers.length < count && attempts < maxAttempts) {
    // Generate a random ticket number between 1 and 9999
    const candidateNumber = Math.floor(Math.random() * 9999) + 1;
    attempts++;
    
    // Skip if we've already added this number to our batch
    if (ticketNumbers.includes(candidateNumber)) {
      console.log(`Skipping duplicate candidate number ${candidateNumber} in current batch`);
      continue;
    }
    
    // Check if this ticket number already exists in the database
    console.log(`Checking if ticket #${candidateNumber} exists in database...`);
    const existingTicket = await ticketsCollection.findOne({ ticketNumber: candidateNumber });
    
    if (existingTicket) {
      console.log(`Ticket #${candidateNumber} already exists in database, generating another`);
    } else {
      console.log(`Ticket #${candidateNumber} is available and will be assigned`);
      ticketNumbers.push(candidateNumber);
    }
  }
  
  if (ticketNumbers.length < count) {
    throw new Error(`Could only generate ${ticketNumbers.length} unique tickets after ${attempts} attempts`);
  }
  
  console.log(`Successfully generated ${count} unique ticket numbers: ${ticketNumbers.join(', ')}`);
  return ticketNumbers;
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});

// Add explicit routes for success and failed pages
app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

app.get('/failed', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'failed.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.post('/initiate-payment', async (req, res) => {
  try {
    console.log('Received payment request:', req.body);
    
    const { email, matricNumber, ticketCount } = req.body;
    
    if (!email || !matricNumber || !ticketCount) {
      return res.status(400).json({ 
        status: false, 
        message: 'Email, matric number and ticket count are required' 
      });
    }
    
    const amount = parseInt(ticketCount) * 500; // 500 Naira per ticket
    console.log('Payment amount:', amount);
    console.log('Using Paystack key:', process.env.PAYSTACK_SECRET_KEY ? 'Key found' : 'Key missing');
    
    // Set the correct base URL for the callback
    const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
    
    // Initialize payment with Paystack
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount: amount * 100, // Convert to kobo
        callback_url: `${baseUrl}/verify-payment`,
        metadata: {
          matricNumber,
          ticketCount: parseInt(ticketCount)
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Paystack response:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('Payment initialization error:');
    if (error.response) {
      console.error('Error data:', error.response.data);
      console.error('Error status:', error.response.status);
    } else if (error.request) {
      console.error('No response received from Paystack');
    } else {
      console.error('Error message:', error.message);
    }
    
    res.status(500).json({ 
      status: false, 
      message: 'Could not initialize payment. Please try again.' 
    });
  }
});

app.get('/verify-payment', async (req, res) => {
  console.log('Verify payment endpoint called with query:', req.query);
  const reference = req.query.reference;
  
  if (!reference) {
    console.log('No reference parameter provided');
    return res.redirect('/failed');
  }
  
  try {
    console.log(`Verifying payment with reference: ${reference}`);
    // Verify payment
    const verifyResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );
    
    console.log('Paystack verification response:', verifyResponse.data);
    const { status, data } = verifyResponse.data;
    
    if (status && data.status === 'success') {
      try {
        console.log('Payment verified successfully');
        const { matricNumber, ticketCount } = data.metadata;
        const email = data.customer.email;
        
        // Generate unique ticket numbers with improved database verification
        console.log(`Generating ${ticketCount} verified unique tickets for ${email}`);
        const ticketNumbers = await generateUniqueTicketNumbers(parseInt(ticketCount));
        
        // Prepare ticket documents for database
        const tickets = ticketNumbers.map(ticketNumber => ({
          matricNumber,
          email,
          ticketNumber,
          purchaseDate: new Date(),
          reference
        }));
        
        // Save to MongoDB
        console.log('Saving tickets to database');
        await db.collection('tickets').insertMany(tickets);
        
        // Send email with tickets
        console.log('Sending email with tickets');
        const emailSent = await sendTicketEmail(email, tickets);
        console.log('Email sent successfully:', emailSent);
        
        // Redirect to success page
        console.log('Redirecting to success page');
        return res.redirect('/success');
      } catch (dbError) {
        console.error('Error processing successful payment:', dbError);
        return res.redirect('/failed');
      }
    } else {
      console.log('Payment verification failed with status:', data.status);
      return res.redirect('/failed');
    }
  } catch (error) {
    console.error('Payment verification error:', error.message);
    if (error.response) {
      console.error('Paystack error response:', error.response.data);
    }
    return res.redirect('/failed');
  }
});

// Function to send email with tickets
async function sendTicketEmail(email, tickets) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    const ticketsHtml = tickets.map(ticket => `
      <div style="border: 2px solid #000; margin: 10px; padding: 15px; width: 300px; text-align: center; background-color: #f8f9fa;">
        <h2 style="margin-bottom: 10px;">RAFFLE TICKET</h2>
        <h1 style="color: #dc3545; font-size: 24px; margin-bottom: 15px;">#${ticket.ticketNumber.toString().padStart(5, '0')}</h1>
        <p style="margin-bottom: 5px;"><strong>Matric Number:</strong> ${ticket.matricNumber}</p>
        <p style="margin-bottom: 15px;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        <p style="font-size: 12px; color: #6c757d;">Valid for the upcoming raffle draw</p>
      </div>
    `).join('');
    
    await transporter.sendMail({
      from: `"Raffle Draw System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Raffle Tickets',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #007bff; text-align: center; margin-bottom: 20px;">Thank You for Your Purchase!</h1>
          <p style="margin-bottom: 20px;">Dear Student,</p>
          <p style="margin-bottom: 20px;">Thank you for purchasing tickets for our raffle draw. Below are your ticket details:</p>
          <div style="display: flex; flex-wrap: wrap; justify-content: center;">
            ${ticketsHtml}
          </div>
          <p style="margin-top: 20px; margin-bottom: 10px;">Please keep these tickets safe. You'll need to reference your ticket numbers if you win.</p>
          <p style="margin-bottom: 20px;">The raffle draw will take place on [DATE]. Good luck!</p>
          <p style="color: #6c757d; font-size: 12px; text-align: center; margin-top: 30px;">This is an automated email. Please do not reply.</p>
        </div>
      `
    });
    
    console.log(`Tickets email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  try {
    await client.close();
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});