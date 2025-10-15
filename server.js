const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5500;

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true
}));
app.use(express.json());

// Database connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'school_management_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// JWT Authentication Middleware - ENHANCED
const authenticateToken = (req, res, next) => {
    console.log('🔐 Authentication middleware called');
    console.log('📋 All headers:', req.headers);
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    console.log('🔑 Auth header:', authHeader);
    console.log('🔑 Token:', token ? token.substring(0, 20) + '...' : 'Missing');

    if (!token) {
        console.log('❌ No token provided');
        return res.status(401).json({
            success: false,
            message: 'Access token required'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key', (err, decoded) => {
        if (err) {
            console.log('❌ Token verification failed:', err.message);
            return res.status(403).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
        
        console.log('✅ Token verified, user:', decoded);
        req.user = decoded;
        next();
    });
};

// ===========================================
// BASIC ROUTES
// ===========================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// 🧪 DEBUG ROUTE - Database Test
app.get('/api/debug/test-db', async (req, res) => {
    try {
        console.log('🧪 Testing database connection...');
        
        // Test 1: Basic connection
        const [rows] = await pool.execute('SELECT 1 + 1 as result');
        console.log('✅ Database connection:', rows);
        
        // Test 2: Check tables
        const [tables] = await pool.execute('SHOW TABLES');
        console.log('✅ Available tables:', tables);
        
        // Test 3: Check users table
        const [users] = await pool.execute('SELECT COUNT(*) as user_count FROM users');
        console.log('✅ Users count:', users);
        
        // Test 4: Check students count
        let studentsCount = 0;
        let studentsData = [];
        try {
            const [studentUsers] = await pool.execute('SELECT COUNT(*) as student_count FROM users WHERE role = "student"');
            studentsCount = studentUsers[0].student_count;
            console.log('✅ Student users count:', studentUsers);
            
            // Get sample students
            const [sampleStudents] = await pool.execute(`
                SELECT id, first_name, last_name, email 
                FROM users 
                WHERE role = "student" AND is_active = TRUE 
                LIMIT 3
            `);
            studentsData = sampleStudents;
        } catch (err) {
            console.log('❌ Students check error:', err.message);
        }
        
        // Test 5: Check classes table
        let classesCount = 0;
        try {
            const [classes] = await pool.execute('SELECT COUNT(*) as class_count FROM classes');
            classesCount = classes[0].class_count;
            console.log('✅ Classes count:', classes);
        } catch (err) {
            console.log('❌ Classes table error:', err.message);
        }
        
        res.json({
            success: true,
            message: 'Database tests completed',
            tests: {
                connection: 'OK',
                tables: tables.map(t => Object.values(t)[0]),
                userCount: users[0].user_count,
                studentCount: studentsCount,
                classCount: classesCount,
                sampleStudents: studentsData
            }
        });
        
    } catch (error) {
        console.error('❌ Database test failed:', error);
        res.status(500).json({
            success: false,
            message: 'Database test failed: ' + error.message
        });
    }
});

// ===========================================
// AUTH ROUTES
// ===========================================

// Enhanced Login Route with Debugging
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        console.log('🔍 Login attempt for:', email);

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Find user
        const [users] = await pool.execute(
            'SELECT id, email, password, role, first_name, last_name FROM users WHERE email = ? AND is_active = TRUE',
            [email]
        );

        if (users.length === 0) {
            console.log('❌ User not found:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const user = users[0];
        console.log('✅ User found:', user.email, 'Role:', user.role);

        // Check password - use bcrypt for hashed passwords, fallback to plain text
        let isPasswordValid = false;
        
        if (user.password.startsWith('$2')) {
            console.log('🔒 Using bcrypt comparison');
            isPasswordValid = await bcrypt.compare(password, user.password);
        } else {
            console.log('🔓 Using plain text comparison');
            isPasswordValid = password === user.password;
        }

        if (!isPasswordValid) {
            console.log('❌ Password validation failed for:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        console.log('✅ Login successful for:', email);

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                role: user.role 
            },
            process.env.JWT_SECRET || 'fallback-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Enhanced SIGNUP/REGISTER ROUTE
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, role, phone } = req.body;

        console.log('📝 Registration attempt for:', email, 'Role:', role);

        // Validate input
        if (!email || !password || !firstName || !lastName || !role) {
            return res.status(400).json({
                success: false,
                message: 'Email, password, first name, last name, and role are required'
            });
        }

        // Check if user already exists
        const [existingUsers] = await pool.execute(
            'SELECT id FROM users WHERE email = ?', 
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Insert new user
        const [result] = await pool.execute(`
            INSERT INTO users (email, password, role, first_name, last_name, phone, is_active)
            VALUES (?, ?, ?, ?, ?, ?, TRUE)
        `, [email, hashedPassword, role, firstName, lastName, phone || null]);

        const userId = result.insertId;

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: userId, 
                email: email, 
                role: role 
            },
            process.env.JWT_SECRET || 'fallback-secret-key',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful!',
            token,
            user: {
                id: userId,
                email,
                role,
                first_name: firstName,
                last_name: lastName
            }
        });

    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ===========================================
// SIMPLE STUDENT ROUTES FOR REACT FRONTEND
// ===========================================

// GET all students - Simple version for React frontend
app.get('/api/students', async (req, res) => {
    try {
        console.log('📍 GET /api/students called (Simple version for React)');
        
        const query = `
            SELECT 
                u.id,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                s.student_id,
                s.roll_number as roll_no,
                s.parent_name,
                s.parent_phone,
                s.address,
                s.admission_date,
                s.date_of_birth,
                u.is_active,
                u.created_at,
                c.grade,
                c.section,
                c.name as class_name,
                COALESCE(s.student_id, CONCAT('STU', LPAD(u.id, 3, '0'))) as student_id
            FROM users u
            LEFT JOIN students s ON u.id = s.user_id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE u.role = 'student' AND u.is_active = TRUE
            ORDER BY u.created_at DESC
        `;
        
        const [result] = await pool.execute(query);
        
        console.log('✅ Found students:', result.length);
        if (result.length > 0) {
            console.log('👨‍🎓 Sample student:', {
                id: result[0].id,
                name: `${result[0].first_name} ${result[0].last_name}`,
                email: result[0].email
            });
        }
        
        res.json(result);
    } catch (error) {
        console.error('❌ Error fetching students:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching students: ' + error.message
        });
    }
});

// POST - Create new student - Simple version for React frontend
app.post('/api/students', async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            grade,
            section,
            rollNo,
            parentName,
            isActive
        } = req.body;

        console.log('📝 Creating student:', firstName, lastName, email);

        // Validate required fields
        if (!firstName || !lastName || !email) {
            return res.status(400).json({
                success: false,
                message: 'First name, last name, and email are required'
            });
        }

        // Check if email already exists
        const [emailCheck] = await pool.execute(
            'SELECT id FROM users WHERE email = ?', 
            [email]
        );
        
        if (emailCheck.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash default password
        const defaultPassword = 'student123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);

        // Create user first
        const [userResult] = await pool.execute(`
            INSERT INTO users (first_name, last_name, email, password, phone, role, is_active)
            VALUES (?, ?, ?, ?, ?, 'student', ?)
        `, [firstName, lastName, email, hashedPassword, phone || null, isActive !== false]);

        const userId = userResult.insertId;
        const studentId = `STU${String(userId).padStart(3, '0')}`;

        console.log('✅ User created with ID:', userId, 'Student ID:', studentId);

        // Find class ID if grade and section provided
        let classId = null;
        if (grade && section) {
            try {
                const [classResult] = await pool.execute(
                    'SELECT id FROM classes WHERE grade = ? AND section = ? AND is_active = TRUE LIMIT 1',
                    [grade, section]
                );
                if (classResult.length > 0) {
                    classId = classResult[0].id;
                    console.log('✅ Found class ID:', classId);
                }
            } catch (err) {
                console.log('⚠️ Could not find class, creating user without class assignment');
            }
        }

        // Create student profile (only if students table exists)
        try {
            await pool.execute(`
                INSERT INTO students (user_id, student_id, roll_number, class_id, parent_name, admission_date, is_active)
                VALUES (?, ?, ?, ?, ?, CURDATE(), TRUE)
            `, [userId, studentId, rollNo || null, classId, parentName || null]);
            console.log('✅ Student profile created');
        } catch (err) {
            console.log('⚠️ Could not create student profile (table may not exist), but user created successfully');
            console.log('⚠️ Error:', err.message);
        }

        res.status(201).json({
            success: true,
            message: 'Student created successfully',
            studentId: userId,
            student: {
                id: userId,
                studentId: studentId,
                firstName: firstName,
                lastName: lastName,
                email: email
            }
        });

    } catch (error) {
        console.error('❌ Error creating student:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating student: ' + error.message
        });
    }
});

// PUT - Update student - Simple version for React frontend
app.put('/api/students/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            firstName,
            lastName,
            email,
            phone,
            grade,
            section,
            rollNo,
            parentName,
            isActive
        } = req.body;

        console.log('✏️ Updating student ID:', id);

        // Validate required fields
        if (!firstName || !lastName || !email) {
            return res.status(400).json({
                success: false,
                message: 'First name, last name, and email are required'
            });
        }

        // Check if student exists
        const [studentCheck] = await pool.execute(
            'SELECT id FROM users WHERE id = ? AND role = "student"', 
            [id]
        );
        
        if (studentCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        // Check if email exists for other users
        const [emailCheck] = await pool.execute(
            'SELECT id FROM users WHERE email = ? AND id != ?', 
            [email, id]
        );
        
        if (emailCheck.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Email already in use by another user'
            });
        }

        // Update user table
        await pool.execute(`
            UPDATE users SET
                first_name = ?,
                last_name = ?,
                email = ?,
                phone = ?,
                is_active = ?
            WHERE id = ? AND role = 'student'
        `, [firstName, lastName, email, phone || null, isActive !== false, id]);

        console.log('✅ User table updated');

        // Update student table if exists
        try {
            // Find class ID if grade and section provided
            let classId = null;
            if (grade && section) {
                const [classResult] = await pool.execute(
                    'SELECT id FROM classes WHERE grade = ? AND section = ? AND is_active = TRUE LIMIT 1',
                    [grade, section]
                );
                if (classResult.length > 0) {
                    classId = classResult[0].id;
                }
            }

            await pool.execute(`
                UPDATE students SET
                    roll_number = ?,
                    class_id = ?,
                    parent_name = ?
                WHERE user_id = ?
            `, [rollNo || null, classId, parentName || null, id]);
            console.log('✅ Student profile updated');
        } catch (err) {
            console.log('⚠️ Could not update student profile (table may not exist), but user updated successfully');
            console.log('⚠️ Error:', err.message);
        }

        res.json({
            success: true,
            message: 'Student updated successfully'
        });

    } catch (error) {
        console.error('❌ Error updating student:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating student: ' + error.message
        });
    }
});

// DELETE student - Simple version for React frontend
app.delete('/api/students/:id', async (req, res) => {
    try {
        const { id } = req.params;

        console.log('🗑️ Deleting student ID:', id);

        // Check if student exists
        const [studentCheck] = await pool.execute(
            'SELECT id FROM users WHERE id = ? AND role = "student"', 
            [id]
        );
        
        if (studentCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        // Soft delete - mark as inactive in users table
        await pool.execute(
            'UPDATE users SET is_active = FALSE WHERE id = ? AND role = "student"',
            [id]
        );

        console.log('✅ User marked as inactive');

        // Also soft delete from students table if exists
        try {
            await pool.execute(
                'UPDATE students SET is_active = FALSE WHERE user_id = ?',
                [id]
            );
            console.log('✅ Student profile marked as inactive');
        } catch (err) {
            console.log('⚠️ Could not update student profile (table may not exist), but user deactivated successfully');
        }

        res.json({
            success: true,
            message: 'Student deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error deleting student:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting student: ' + error.message
        });
    }
});

// GET single student - Simple version for React frontend
app.get('/api/students/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log('👤 Getting student ID:', id);
        
        const query = `
            SELECT 
                u.id,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                s.student_id,
                s.roll_number as roll_no,
                s.parent_name,
                s.parent_phone,
                s.address,
                s.admission_date,
                s.date_of_birth,
                u.is_active,
                u.created_at,
                c.grade,
                c.section,
                c.name as class_name,
                COALESCE(s.student_id, CONCAT('STU', LPAD(u.id, 3, '0'))) as student_id
            FROM users u
            LEFT JOIN students s ON u.id = s.user_id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE u.id = ? AND u.role = 'student'
        `;
        
        const [result] = await pool.execute(query, [id]);
        
        if (result.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }
        
        console.log('✅ Student found:', result[0].first_name, result[0].last_name);
        
        res.json(result[0]);
    } catch (error) {
        console.error('❌ Error fetching student:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching student: ' + error.message
        });
    }
});

// 🧪 DEBUG ROUTE - Test student creation manually
app.get('/api/debug/create-test-student', async (req, res) => {
    try {
        console.log('🧪 Creating test student...');
        
        // Check if test student already exists
        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE email = ?', 
            ['test.student@example.com']
        );
        
        if (existing.length > 0) {
            return res.json({
                success: true,
                message: 'Test student already exists',
                studentId: existing[0].id
            });
        }
        
        // Create test student
        const hashedPassword = await bcrypt.hash('student123', 12);
        
        const [userResult] = await pool.execute(`
            INSERT INTO users (first_name, last_name, email, password, phone, role, is_active)
            VALUES (?, ?, ?, ?, ?, 'student', TRUE)
        `, ['Test', 'Student', 'test.student@example.com', hashedPassword, '1234567890']);
        
        const userId = userResult.insertId;
        const studentId = `STU${String(userId).padStart(3, '0')}`;
        
        console.log('✅ Test student created:', userId, studentId);
        
        res.json({
            success: true,
            message: 'Test student created successfully',
            studentId: userId,
            details: {
                id: userId,
                name: 'Test Student',
                email: 'test.student@example.com',
                studentId: studentId
            }
        });
        
    } catch (error) {
        console.error('❌ Error creating test student:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating test student: ' + error.message
        });
    }
});

// ===========================================
// CLASS MANAGEMENT ROUTES
// ===========================================

// Get all classes with student count - ENHANCED
app.get('/api/classes/management', authenticateToken, async (req, res) => {
    try {
        console.log('📍 GET /api/classes/management called');
        
        const [classes] = await pool.execute(`
            SELECT 
                c.*,
                COUNT(s.id) as student_count,
                CONCAT(u.first_name, ' ', u.last_name) as teacher_name
            FROM classes c
            LEFT JOIN students s ON c.id = s.class_id AND s.is_active = TRUE
            LEFT JOIN users u ON c.teacher_id = u.id
            WHERE c.is_active = TRUE
            GROUP BY c.id
            ORDER BY c.grade ASC, c.section ASC
        `);
        
        console.log('✅ Classes found:', classes.length);
        console.log('📊 Sample class:', classes[0] || 'No classes');
        
        res.json({
            success: true,
            count: classes.length,
            classes
        });
        
    } catch (error) {
        console.error('❌ Error fetching classes:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch classes'
        });
    }
});

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, async () => {
    try {
        await pool.getConnection();
        console.log(`🚀 Server running on port ${PORT}`);
        console.log('✅ Database connected successfully');
        console.log('🔗 Test these URLs:');
        console.log(`   - http://localhost:${PORT}/api/health`);
        console.log(`   - http://localhost:${PORT}/api/debug/test-db`);
        console.log(`   - http://localhost:${PORT}/api/students`);
        console.log(`   - http://localhost:${PORT}/api/debug/create-test-student`);
        console.log('📊 Ready for React frontend!');
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
});
