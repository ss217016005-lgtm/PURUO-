const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'posts.json');

app.use(express.json());
app.use(express.static(__dirname));

// פונקציית עזר לקריאת הנתונים מהקובץ
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) return [];
    const content = fs.readFileSync(DATA_FILE);
    return JSON.parse(content);
};

// פונקציית עזר לכתיבת נתונים לקובץ
const writeData = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// נתיב לקבלת כל הפוסטים
app.get('/api/posts', (req, res) => {
    res.json(readData());
});

// נתיב להוספת פוסט חדש
app.post('/api/posts', (req, res) => {
    const posts = readData();
    const newPost = {
        id: Date.now(),
        author: req.body.author,
        content: req.body.content,
        date: new Date().toLocaleString('he-IL')
    };
    posts.push(newPost);
    writeData(posts);
    res.status(201).json(newPost);
});

// נתיב למחיקת פוסט (עבור האדמין)
app.delete('/api/posts/:id', (req, res) => {
    let posts = readData();
    const id = parseInt(req.params.id);
    posts = posts.filter(post => post.id !== id);
    writeData(posts);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
