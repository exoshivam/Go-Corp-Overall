# 🚗 GoCorp - Corporate Ride Sharing Platform

[![Status](https://img.shields.io/badge/status-active-brightgreen)](https://github.com)
[![License](https://img.shields.io/badge/license-ISC-blue)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19.2-blue)](https://react.dev)

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development](#development)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [Support](#support)

## 🎯 Overview

GoCorp is a comprehensive corporate ride-sharing platform designed to streamline employee transportation. The system intelligently matches riders, clusters trips for efficiency, and assigns drivers—all while providing a seamless experience for employees, drivers, and administrators.

### What It Does

GoCorp solves the corporate transportation challenge by:
- **Streamlining ride bookings** for employees with origin and destination flexibility
- **Intelligent ride clustering** to optimize driver assignments and reduce costs
- **Real-time ride tracking** with location-based services
- **Multi-role support** for employees, drivers, and admins with tailored interfaces
- **Secure payments** integrated with Razorpay
- **Notification system** for real-time ride updates

## ✨ Key Features

### For Employees
- 🎯 **Easy Ride Booking** - Book rides from/to office with flexible scheduling
- 👥 **Group Ride Options** - Travel with colleagues or request solo rides
- 📍 **Location-Based Matching** - Real-time location services with interactive maps
- 💳 **Wallet System** - Prepaid wallet for seamless payment processing
- 🔔 **Live Notifications** - Real-time updates on ride status and driver location
- 🔐 **Secure Authentication** - JWT-based authentication with OTP verification

### For Drivers
- 📊 **Smart Trip Assignment** - AI-powered ride clustering and batch assignment
- 📱 **Driver Dashboard** - Track assigned rides and earnings
- 🗺️ **Route Optimization** - Map integration for optimal route planning
- 💰 **Earnings Management** - Real-time earnings and transaction history

### For Admins
- 🏢 **Company Management** - Multi-company and office administration
- 📈 **Analytics Dashboard** - Ride metrics and system performance
- 👤 **User Management** - Employee and driver verification
- ⚙️ **System Configuration** - Office hours, ride settings, and policies

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GoCorp Platform                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Employee    │  │    Driver    │  │     Admin    │    │
│  │  Frontend    │  │   Frontend   │  │  Dashboard   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │             │
│         └─────────────────┼─────────────────┘             │
│                           │                               │
│                   ┌───────▼────────┐                      │
│                   │  REST API      │                      │
│                   │  (Express.js)  │                      │
│                   └───────┬────────┘                      │
│                           │                               │
│         ┌─────────────────┼─────────────────┐             │
│         │                 │                 │             │
│    ┌────▼────┐    ┌──────▼──────┐   ┌─────▼────┐        │
│    │ Ride    │    │ Driver      │   │ Polling  │        │
│    │ Module  │    │ Module      │   │ & Batch  │        │
│    └────┬────┘    └──────┬──────┘   └─────┬────┘        │
│         │                │                │                 │
│    ┌────┴────────────────┴────────────────┴─────┐           │
│    │    MongoDB Database                        │           │
│    │  (Rides, Users, Drivers, Clusters, etc)   │            │
│    └──────────────────────────────────────────┘             │
│                                                             │
│    ┌──────────────────────────────────────┐                 │
│    │  External Services                   │                 │
│    │  • Razorpay (Payments)               │                 │
│    │  • NodeMailer (Email)                │                 │
│    │  • Leaflet Maps (Location)           │                 │
│    │  • Turf.js (Geospatial Analysis)     │                 │
│    └──────────────────────────────────────┘                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 💾 Tech Stack

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js 5.2
- **Database**: MongoDB with Mongoose 9.3
- **Authentication**: JWT (jsonwebtoken)
- **Security**: Bcrypt, Helmet, CORS, Rate Limiting
- **Payment**: Razorpay
- **Email**: Nodemailer
- **Geospatial**: Turf.js, Geolib
- **Scheduling**: Node Cron
- **Utilities**: Axios, UUID, Crypto-JS

### Frontend (All three apps use the same stack)
- **Library**: React 19.2
- **Build Tool**: Vite 8.0
- **Styling**: Tailwind CSS 4.2, PostCSS
- **Routing**: React Router 7.13
- **HTTP Client**: Axios 1.14
- **Maps**: Leaflet 1.9, React Leaflet 5.0
- **Animation**: Framer Motion 12.38
- **Linting**: ESLint 9.39

## 📁 Project Structure

```
GoCorp-Overall/
├── GoCorp-Backend-main/          # Node.js/Express backend
│   ├── src/
│   │   ├── config/               # Database and environment config
│   │   ├── middleware/           # Auth, error handling middleware
│   │   ├── modules/
│   │   │   ├── company/          # Company management
│   │   │   ├── driver/           # Driver management
│   │   │   ├── ride/             # Ride booking and management
│   │   │   ├── polling/          # Ride clustering and batching
│   │   │   ├── maps/             # Location services
│   │   │   ├── notification/     # Notification system
│   │   │   ├── wallet/           # Wallet management
│   │   │   ├── office/           # Office management
│   │   │   └── user/             # User management
│   │   └── utils/                # Helper utilities
│   ├── server.js                 # Express app setup
│   └── package.json
│
├── GoCorp-Frontend-main/         # Customer-facing React app
│   ├── src/
│   │   ├── components/           # Reusable components
│   │   ├── pages/                # Page components
│   │   ├── context/              # State management (Context API)
│   │   ├── services/             # API client modules
│   │   ├── hooks/                # Custom React hooks
│   │   └── utils/                # Utility functions
│   ├── vite.config.js
│   └── package.json
│
├── Driver-Frontend/              # Driver-facing React app
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── context/
│   │   ├── services/
│   │   └── utils/
│   └── package.json
│
└── Go-Corp-Admin/                # Admin dashboard React app
    ├── src/
    │   ├── components/
    │   ├── dashboard/
    │   ├── pages/
    │   ├── services/
    │   └── utils/
    └── package.json
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.x or higher (or yarn)
- **MongoDB** 5.0+ (local or Atlas)
- **Git** for version control

### Installation & Setup

#### 1. Clone the Repository

```bash
git clone <repository-url>
cd GoCorp-Overall
```

#### 2. Backend Setup

```bash
cd GoCorp-Backend-main

# Install dependencies
npm install

# Create .env file with required variables
cat > .env << EOF
# Server
PORT=5000
NODE_ENV=development

# Database
MONGO_URI=mongodb://localhost:27017/gocorp
# OR for MongoDB Atlas:
# MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/gocorp

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRE=7d

# Razorpay (Payment Integration)
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret

# Email Configuration (Nodemailer)
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password

# Maps & Geolocation
OSRM_SERVER=https://router.project-osrm.org

# Frontend URL
FRONTEND_URL=http://localhost:5173
EOF

# Start the backend server
npm run dev
# Server will run on http://localhost:5000
```

#### 3. Frontend Setup (Customer App)

```bash
cd ../GoCorp-Frontend-main

# Install dependencies
npm install

# Create .env.local file
cat > .env.local << EOF
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPS_API_KEY=your_maps_api_key
EOF

# Start development server
npm run dev
# Frontend will run on http://localhost:5173
```

#### 4. Driver Frontend Setup

```bash
cd ../Driver-Frontend

npm install
cat > .env.local << EOF
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPS_API_KEY=your_maps_api_key
EOF

npm run dev
# Driver app will run on http://localhost:5174 (or next available port)
```

#### 5. Admin Dashboard Setup

```bash
cd ../Go-Corp-Admin

npm install
cat > .env.local << EOF
VITE_API_BASE_URL=http://localhost:5000/api
EOF

npm run dev
# Admin dashboard will run on http://localhost:5175 (or next available port)
```

### Verify Installation

Check the backend health endpoint:
```bash
curl http://localhost:5000/api/health
# Expected response: { "success": true, "message": "Server is healthy" }
```

## 💻 Development

### Available Scripts

#### Backend
```bash
npm run start    # Production: run with node
npm run dev      # Development: run with nodemon (auto-reload)
npm test         # Run tests (currently not configured)
```

#### Frontends (All three apps)
```bash
npm run dev      # Start Vite dev server with HMR
npm run build    # Build for production
npm run preview  # Preview production build locally
npm run lint     # Run ESLint checks
```

### Code Structure & Conventions

#### Backend - Modular Architecture
Each module follows this structure:
```
module/
├── module.model.js      # Mongoose schemas
├── module.routes.js     # Express routes
├── module.controller.js  # Route handlers
├── module.service.js    # Business logic
├── module.validation.js # Input validation
└── [optional] module.jobs.js  # Cron jobs
```

#### Frontend - Component-Based
- **Components**: Reusable UI components (buttons, forms, cards)
- **Pages**: Full-page components for routing
- **Services**: API client functions organized by domain
- **Context**: Global state management (User, UI, etc.)
- **Hooks**: Custom React hooks for logic reuse

### Key Workflows

#### Employee Books a Ride
```
1. Employee logs in and navigates to booking
2. Selects pickup/drop locations and time
3. System validates office hours and conflicts
4. Ride is created with status: PENDING
5. Automatic submission to polling system
6. Clustering algorithm processes the ride
7. Driver assigned when batch is ready
8. Real-time notifications sent to employee
```

#### Ride Clustering & Polling
The system implements an intelligent 6-case clustering algorithm:
- **Solo Preference**: Immediate driver assignment
- **Group 4 Riders**: All grouped together
- **Singles/Pairs**: Clustered with similar rides
- **Force Batch**: Every 1 minute to prevent indefinite waiting

See [GoCorp-Backend-main/SYSTEM_COMPLETE.md](./GoCorp-Backend-main/SYSTEM_COMPLETE.md) for detailed system documentation.

## 📚 API Documentation

The backend provides RESTful APIs for all operations:

### Base URL
```
http://localhost:5000/api
```

### Main Endpoints

| Module | Endpoints | Purpose |
|--------|-----------|---------|
| **User** | `/api/user/*` | Authentication, profile management |
| **Ride** | `/api/ride/*` | Ride booking, tracking, history |
| **Driver** | `/api/driver/*` | Driver registration, availability |
| **Company** | `/api/company/*` | Company/office management |
| **Polling** | `/api/polling/*` | Ride clustering and batching |
| **Wallet** | `/api/wallet/*` | Payment and wallet operations |
| **Maps** | `/api/maps/*` | Location services and routing |
| **Notification** | `/api/notification/*` | Notification management |

### Example: Book a Ride
```bash
curl -X POST http://localhost:5000/api/ride/book \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "employee_id": "user_id",
    "office_id": "office_id",
    "scheduled_at": "2024-04-25T09:00:00Z",
    "pickup_location": [73.9124, 40.7580],
    "drop_location": [73.9855, 40.7614],
    "pickup_address": "123 Main St",
    "drop_address": "456 Office Blvd",
    "solo_preference": false
  }'
```

For complete API documentation, refer to backend route files in [GoCorp-Backend-main/src/modules/](./GoCorp-Backend-main/src/modules/).

## 🔧 Configuration

### Environment Variables

#### Backend (.env)
```
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://...
JWT_SECRET=your_secret
JWT_EXPIRE=7d
RAZORPAY_KEY_ID=rzp_...
RAZORPAY_KEY_SECRET=...
EMAIL_SERVICE=gmail
EMAIL_USER=...
EMAIL_PASSWORD=...
```

#### Frontends (.env.local)
```
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPS_API_KEY=... (if using external maps API)
```

## 🤝 Contributing

We welcome contributions! To get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/your-feature`
3. **Commit** your changes: `git commit -m 'Add your feature'`
4. **Push** to the branch: `git push origin feature/your-feature`
5. **Open** a Pull Request

### Development Guidelines
- Follow the existing code structure and naming conventions
- Write clear commit messages
- Test your changes before submitting
- Update documentation if you modify features
- Ensure no sensitive data is committed

## 🆘 Support & Help

### Getting Help
- **Issues**: [GitHub Issues](./issues) - Report bugs and feature requests
- **Documentation**: Check [GoCorp-Backend-main/README.md](./GoCorp-Backend-main/README.md) for backend details
- **Code Examples**: Explore the service modules for API usage patterns

### Troubleshooting

#### MongoDB Connection Issues
```bash
# Check if MongoDB is running
# For local MongoDB: mongod should be running
# For Atlas: verify connection string and IP whitelist
```

#### Port Already in Use
```bash
# Change the port in .env
# Or kill the process using the port
# On Windows: netstat -ano | findstr :5000
# On macOS/Linux: lsof -i :5000
```

#### CORS/API Errors
- Verify `FRONTEND_URL` in backend `.env` matches your frontend URL
- Check that the API base URL in frontend matches backend server address

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](./LICENSE) file for details.

## 👥 Team & Maintenance

**Current Maintainers**: GoCorp Development Team

For questions or collaboration, please reach out through GitHub issues or pull requests.

---

**Last Updated**: April 2024  
**Version**: 1.0.0

Made with ❤️ for corporate transportation
