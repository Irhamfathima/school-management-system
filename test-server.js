const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth'); // Add this line

const app = express();
app.use(cors());
app.use(express.json());

// Add auth routes
app.use('/api/auth', authRoutes);

// Your other routes...

app.listen(5500, () => {
  console.log('Server running on port 5500');
});