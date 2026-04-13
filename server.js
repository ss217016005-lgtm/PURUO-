const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

// הגדרות נתיבים
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.PORT;
const DATA_DIR = isRailway ? '/app/data' : path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const getILTime = () => new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

// נתונים ראשוניים
const newCategoriesList = ["תמונות והסרטות", "הלכה למעשה", "תורת רבותינו", "בית המדרש", "השקפה", "מחשבים וטכנולגיה", "זיכרון להולכים", "סלבודקא", "עזרה הדדית", "קורות דורות", "אקטואליה", "הפורום שלנו", "חדשות בציבור"];
const defaultTags = [{ name: 'שיתוף', color: '#3b82f6' }, { name: 'באג', color: '#ef4444' }, { name: 'שאלה', color: '#f59e0b' }, { name: 'להורדה', color: '#10b981' }];
const defaultDB = { 
    users: [], categories: newCategoriesList, tags: defaultTags, posts: [], reports: [], messages: [], auditLogs: [], links: [],
    settings: { rules: "ברוכים הבאים לפורום פרומרקייט!", floatingMessage: { text: "", color: "#f59e0b", id: 0 } }
};

const MONGODB_URI = "mongodb+srv://w217016005_db_user:771fEhHF0z26gIGl@cluster0.e7lsmeb.mongodb.net/ForumDB?retryWrites=true&w=majority";

// הגדרת מודל הנתונים
const dbSchema = new mongoose.Schema({}, { strict: false });
const DBModel = mongoose.model('Database', dbSchema);

async function getDB() {
    let doc = await DBModel.findOne();
    if (!doc) { doc = new DBModel(defaultDB); await doc.save(); }
    return doc.toObject();
}

async function saveDB(dbData) {
    const { _id, ...updateData } = dbData;
    await DBModel.updateOne({ _id }, { $set: updateData });
}

const onlineTracker = {};
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));
app.set('trust proxy', true);

const upload = multer({ dest: '/tmp/' }); // העלאה זמנית לתיקיית מערכת

// עזרים
function isVeteran(user) { return (user.role === 'admin' || user.role === 'mod' || user.role === 'editor' || (user.totalLikes >= 10)); }

// --- נתיבי API של הפורום --- (כל הקוד שכתבנו קודם נכנס כאן)
app.get('/api/settings', async (req, res) => res.json((await getDB()).settings));

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; const db = await getDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    res.json({ message: "התחברת!", username: user.username, role: user.role });
});

app.get('/api/posts', async (req, res) => {
    const db = await getDB();
    res.json(db.posts.sort((a, b) => b.lastUpdated - a.lastUpdated));
});

// --- נתיבי ה-VPS (הענן) ---
const VPS_URL = "http://161.97.116.66:8000";
const VPS_API_KEY = "your_secret_password_123";

app.get('/api/cloud/list/:category', async (req, res) => {
    try {
        const response = await axios.get(`${VPS_URL}/list/${req.params.category}`, { headers: { 'x-api-key': VPS_API_KEY } });
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: "שגיאה מול ה-VPS" }); }
});

app.post('/api/cloud/upload/:category', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "אין קובץ" });
    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        const response = await axios.post(`${VPS_URL}/upload/${req.params.category}`, form, {
            headers: { ...form.getHeaders(), 'x-api-key': VPS_API_KEY }
        });
        fs.unlinkSync(req.file.path);
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: "העלאה ל-VPS נכשלה" }); }
});

// --- פקודת הפעלה אחת ויחידה ---
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ מחובר ל-MongoDB');
        app.listen(PORT, () => console.log(`🚀 השרת רץ בפורט ${PORT}`));
    })
    .catch(err => console.error('❌ שגיאת התחברות למונגו:', err));
