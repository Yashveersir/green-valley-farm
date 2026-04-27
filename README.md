# Green Valley Poultry Farm 🐔

**Live Demo:** [https://www.green-valley-farm.online/#](https://www.green-valley-farm.online/#)

A full-stack web application for browsing and ordering fresh poultry products directly from a premium poultry farm. This application provides a modern e-commerce experience with user authentication, shopping cart functionality, order management, and an admin dashboard.

![Green Valley Poultry Farm](public/images/hero-banner.png)

## 🌟 Features

### Frontend
- **Responsive Design**: Mobile-first, fully responsive UI with modern aesthetics
- **Product Catalog**: Browse poultry products with images, descriptions, and pricing
- **Shopping Cart**: Add/remove items, adjust quantities, and view cart total
- **User Authentication**: Login/register with OTP verification via email/SMS
- **Order Management**: View order history and track order status
- **Search & Filter**: Search products by name and filter by category
- **Admin Dashboard**: Manage products, view orders, and update inventory

### Backend
- **RESTful API**: Node.js/Express server with structured endpoints
- **Database**: MongoDB for persistent storage with Mongoose ODM
- **Authentication**: JWT-based authentication with role-based access control
- **File Upload**: Product image upload and management
- **Email/SMS Integration**: Nodemailer for emails and Twilio for SMS notifications
- **Memory Fallback**: In-memory storage when MongoDB is unavailable
- **Payment Gateway**: Razorpay integration for processing online payments and verifying transactions

## 🏗️ Project Structure

```
green-valley-poultry-farm/
├── public/                 # Static frontend files
│   ├── index.html         # Main application page
│   ├── admin.html         # Admin dashboard
│   ├── css/               # Stylesheets
│   ├── js/                # Frontend JavaScript
│   └── images/            # Product images and assets
├── routes/                # Express route handlers
│   ├── auth.js           # Authentication endpoints
│   ├── products.js       # Product management
│   ├── cart.js           # Shopping cart operations
│   ├── orders.js         # Order processing
│   └── admin.js          # Admin-only endpoints
├── models/               # Data models and database logic
│   ├── db.js            # MongoDB connection
│   └── store.js         # In-memory store with persistence
├── data/                 # JSON data files
│   └── products.json    # Initial product catalog
├── server.js            # Main Express server
├── package.json         # Dependencies and scripts
├── vercel.json          # Vercel deployment configuration
└── .gitignore           # Git ignore rules
```

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (optional, for persistent storage)
- npm or yarn package manager

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd green-valley-poultry-farm
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root directory with the following variables:
   ```env
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/greenvalley
   JWT_SECRET=your_jwt_secret_key_here
   EMAIL_USER=your_email@gmail.com
   EMAIL_PASS=your_email_app_password
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_PHONE_NUMBER=+1234567890
   RAZORPAY_KEY_ID=your_razorpay_key_id
   RAZORPAY_KEY_SECRET=your_razorpay_key_secret
   ```

4. **Start the development server**
   ```bash
   npm start
   ```
   or
   ```bash
   node server.js
   ```

5. **Access the application**
   - Frontend: http://localhost:3000
   - Admin Dashboard: http://localhost:3000/admin.html
   - API Base URL: http://localhost:3000/api

## 📦 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user (sends OTP)
- `POST /api/auth/verify-otp` - Verify OTP and get JWT token
- `POST /api/auth/login` - Login with phone/email (sends OTP)
- `GET /api/auth/me` - Get current user profile (requires auth)

### Products
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get single product by ID
- `POST /api/products` - Create new product (admin only)
- `PUT /api/products/:id` - Update product (admin only)
- `DELETE /api/products/:id` - Delete product (admin only)

### Cart
- `GET /api/cart` - Get user's cart (requires auth)
- `POST /api/cart` - Add item to cart (requires auth)
- `PUT /api/cart/:productId` - Update cart item quantity (requires auth)
- `DELETE /api/cart/:productId` - Remove item from cart (requires auth)
- `DELETE /api/cart` - Clear entire cart (requires auth)

### Orders
- `GET /api/orders` - Get user's orders (requires auth)
- `POST /api/orders` - Create new order from cart (requires auth)
- `GET /api/orders/:id` - Get order details (requires auth)
- `PUT /api/orders/:id/status` - Update order status (admin only)

### Admin
- `GET /api/admin/stats` - Get dashboard statistics (admin only)
- `GET /api/admin/orders` - Get all orders (admin only)
- `GET /api/admin/users` - Get all users (admin only)

### Payments
- `POST /api/payments/create-order` - Create a Razorpay order (requires auth)
- `POST /api/payments/verify-payment` - Verify payment signature and place the order (requires auth)

## 🔧 Configuration

### Database Options
The application supports two storage modes:

1. **MongoDB (Recommended)**: Set `MONGODB_URI` in `.env` file
2. **In-Memory Storage**: If no MongoDB URI is provided, the app uses in-memory storage with file persistence to `data/` directory

### Email Configuration
For OTP verification emails, configure your email service in `.env`:
- Gmail users need an "App Password" for `EMAIL_PASS`
- Other SMTP services can be configured in `models/store.js`

### SMS Configuration (Twilio)
For SMS OTP verification:
1. Sign up for Twilio and get Account SID, Auth Token, and Phone Number
2. Add these to your `.env` file
3. The app will send SMS OTPs for phone-based login

### Payment Configuration (Razorpay)
For processing online payments:
1. Create a Razorpay account and generate API keys from the dashboard
2. Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to your `.env` file
3. Ensure the frontend has access to the standard Razorpay checkout script

## 🎨 Frontend Features

### User Interface
- **Home Page**: Hero banner, featured products, farm information
- **Product Grid**: Card-based layout with images, prices, and add-to-cart buttons
- **Shopping Cart**: Sidebar cart with real-time updates
- **Checkout Process**: Multi-step order placement
- **Order History**: Timeline view of past orders
- **Admin Panel**: Dashboard with charts, product management, and order processing

### Technologies Used
- **HTML5**: Semantic markup
- **CSS3**: Custom styles with Flexbox/Grid
- **JavaScript (ES6+)**: Vanilla JS with modular architecture
- **Font Awesome**: Icons for UI elements
- **Google Fonts**: Typography (Outfit, Playfair Display)

## 🚢 Deployment

### Live Demo
The application is deployed and accessible at:
**🌐 [https://www.green-valley-farm.online/#](https://www.green-valley-farm.online/#)**

**Features available in the live demo:**
- Browse product catalog with images and descriptions
- Add items to shopping cart
- User registration and login (OTP verification simulated)
- Admin dashboard (login with admin credentials)
- Responsive design across all devices

### Vercel Deployment
This project is configured for easy deployment on Vercel:

1. **Push to GitHub** repository
2. **Import project** in Vercel dashboard
3. **Configure environment variables** in Vercel project settings
4. **Deploy** with automatic CI/CD

The `vercel.json` file includes:
- Serverless function configuration for `server.js`
- Static file serving from `public/` directory
- Route rewrites for client-side routing

### Manual Deployment
For traditional hosting:
```bash
# Build step (if needed)
npm run build

# Start production server
NODE_ENV=production npm start
```

## 📝 Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `MONGODB_URI` | MongoDB connection string | (none) |
| `JWT_SECRET` | Secret for signing JWT tokens | (required) |
| `EMAIL_USER` | Email address for sending OTPs | (required) |
| `EMAIL_PASS` | Email password/App password | (required) |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | (optional) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | (optional) |
| `TWILIO_PHONE_NUMBER` | Twilio phone number | (optional) |
| `RAZORPAY_KEY_ID` | Razorpay API Key ID | (required for online payments) |
| `RAZORPAY_KEY_SECRET` | Razorpay API Key Secret | (required for online payments) |

## 🔒 Security Features

- **JWT Authentication**: Token-based authentication for API requests
- **OTP Verification**: One-time passwords for user registration/login
- **Input Validation**: Server-side validation for all API endpoints
- **CORS Configuration**: Restricted to frontend domain
- **Rate Limiting**: Basic rate limiting on auth endpoints
- **Admin Middleware**: Role-based access control for admin routes

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check if MongoDB is running: `mongod --version`
   - Verify connection string in `.env`
   - The app will fall back to in-memory storage if MongoDB is unavailable

2. **Email Not Sending**
   - Verify email credentials in `.env`
   - For Gmail, ensure "Less secure app access" is enabled or use App Password
   - Check server logs for SMTP errors

3. **Admin Access Not Working**
   - Default admin user is created on first run
   - Check `models/store.js` for admin initialization
   - Use the admin login from the admin panel

4. **Images Not Loading**
   - Ensure product images are in `public/product-images/`
   - Check file permissions and paths
   - Restart server after adding new images

### Logs
- Application logs are written to `logs.txt` and `logs2.txt`
- Debug information is printed to console with `console.log()`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines
- Follow existing code style and structure
- Add comments for complex logic
- Update documentation for new features
- Test changes thoroughly before submitting

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Icons from [Font Awesome](https://fontawesome.com/)
- Fonts from [Google Fonts](https://fonts.google.com/)
- UI inspiration from modern e-commerce platforms
- Product images from Green Valley Poultry Farm

## 📞 Support

For support, please:
1. Check the troubleshooting section above
2. Review server logs for error messages
3. Open an issue on GitHub with detailed description

---

**Green Valley Poultry Farm** – Fresh poultry delivered with care. 🐓🥚