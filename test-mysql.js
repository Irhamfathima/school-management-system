const mysql = require('mysql2/promise');

async function testAllPasswords() {
    const passwords = ['', '123456', 'root', 'password', 'admin'];
    
    console.log('Testing MySQL connection with different passwords...\n');
    
    for (const pwd of passwords) {
        try {
            const connection = await mysql.createConnection({
                host: 'localhost',
                user: 'root',
                password: pwd,
                database: 'school_management_system'
            });
            
            console.log(`✅ SUCCESS with password: "${pwd}"`);
            console.log(`Update your .env: DB_PASSWORD=${pwd}`);
            await connection.end();
            return;
        } catch (error) {
            console.log(`❌ Failed with password: "${pwd}" - ${error.message}`);
        }
    }
    
    console.log('\n❌ None of the common passwords worked');
    console.log('You may need to reset your MySQL root password');
}

testAllPasswords();
