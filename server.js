const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// === הגדרת נתיבים חכמה (תומך גם במחשב וגם ב-Railway) ===
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.PORT;
const DATA_DIR = isRailway ? '/app/data' : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// יצירת תיקיות אם הן לא קיימות
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// === הגדרת מסד הנתונים הראשוני ===
const defaultDB = {
    users: [], // { username, password, isApproved: false, isAdmin: false }
    categories: ["כללי", "עזרה טכנית", "דיבורים"],
    posts: [] // { id, category, author, content, date, fileUrl }
};

// פונקציות לקריאה וכתיבה מהירה למסד הנתונים
const readDB = () => {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDB, null, 2));
        return defaultDB;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE));
};

const writeDB = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// === הגדרת העלאת קבצים (Multer) ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// === הגדרות שרת בסיסיות ===
app.use(express.json());
app.use(express.static(__dirname)); // הגשת קבצי HTML/CSS
app.use('/uploads', express.static(UPLOADS_DIR)); // הגשת הקבצים שהועלו

// ==========================================
// 1. ניהול משתמשים והרשמה
// ==========================================

// הרשמת משתמש חדש (ממתין לאישור)
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: "שם המשתמש כבר קיים במערכת." });
    }

    db.users.push({ 
        username, 
        password, // הערה: במערכת אמיתית חובה להצפין סיסמאות!
        isApproved: false, 
        isAdmin: db.users.length === 0 // המשתמש הראשון שנרשם יהיה אוטומטית מנהל
    });
    
    writeDB(db);
    res.json({ message: "נרשמת בהצלחה. אנא המתן לאישור מנהל." });
});

// התחברות
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);

    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    if (!user.isApproved && !user.isAdmin) return res.status(403).json({ error: "החשבון שלך עדיין ממתין לאישור מנהל." });

    res.json({ message: "התחברת בהצלחה!", username: user.username, isAdmin: user.isAdmin });
});

// ==========================================
// 2. ממשק מנהל (אישור משתמשים)
// ==========================================

// קבלת רשימת משתמשים לא מאושרים
app.get('/api/admin/pending-users', (req, res) => {
    const db = readDB();
    const pending = db.users.filter(u => !u.isApproved && !u.isAdmin).map(u => u.username);
    res.json(pending);
});

// אישור משתמש
app.post('/api/admin/approve', (req, res) => {
    const { username } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    
    if (user) {
        user.isApproved = true;
        writeDB(db);
        res.json({ success: true, message: `המשתמש ${username} אושר בהצלחה.` });
    } else {
        res.status(404).json({ error: "משתמש לא נמצא." });
    }
});

// ==========================================
// 3. קטגוריות ופוסטים
// ==========================================

// קבלת כל הקטגוריות
app.get('/api/categories', (req, res) => {
    res.json(readDB().categories);
});

// קבלת פוסטים (אפשר לסנן לפי קטגוריה: /api/posts?category=כללי)
app.get('/api/posts', (req, res) => {
    const category = req.query.category;
    const db = readDB();
    let posts = db.posts;
    
    if (category) {
        posts = posts.filter(p => p.category === category);
    }
    res.json(posts);
});

// הוספת פוסט חדש (כולל אופציה לקובץ מצורף)
app.post('/api/posts', upload.single('attachedFile'), (req, res) => {
    const { author, content, category } = req.body;
    const file = req.file;
    const db = readDB();

    // בדיקה שהמשתמש קיים ומאושר
    const user = db.users.find(u => u.username === author);
    if (!user || (!user.isApproved && !user.isAdmin)) {
        return res.status(403).json({ error: "אין לך הרשאה לפרסם פוסטים." });
    }

    const newPost = {
        id: Date.now(),
        author,
        category: category || "כללי",
        content,
        date: new Date().toLocaleString('he-IL'),
        fileUrl: file ? `/uploads/${file.filename}` : null
    };

    db.posts.push(newPost);
    writeDB(db);
    res.status(201).json(newPost);
});

// מחיקת פוסט (לאדמין)
app.delete('/api/posts/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const db = readDB();
    
    const postIndex = db.posts.findIndex(p => p.id === id);
    if (postIndex !== -1) {
        // מחיקת הקובץ הפיזי אם קיים
        const fileUrl = db.posts[postIndex].fileUrl;
        if (fileUrl) {
            const filePath = path.join(DATA_DIR, fileUrl.replace('/uploads/', 'uploads/'));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        
        db.posts.splice(postIndex, 1);
        writeDB(db);
    }
    res.json({ success: true });
});

// הפעלת השרת
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Data directory set to: ${DATA_DIR}`);
});
