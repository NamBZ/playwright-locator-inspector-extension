# 🎯 Playwright Locator Inspector

Chrome Extension (Manifest V3) để inspect element và generate locator string cho Playwright.  
UX giống WhatFont — tooltip nổi, realtime, không popup.

## ✨ Features

- **Hover** → highlight element + hiển thị locator string trong tooltip
- **Click** → mở modal cho phép copy từng loại locator
- **3 loại locator** trong modal:
  - 🎭 **Playwright** — locator theo format Playwright (`button:Lưu`, `#id`, `link:Text`...)
  - 🔍 **CSS Selector** — CSS selector unique cho element
  - 📊 **Grid** — selector đặc biệt cho input trong `table.gridX` (hiển thị Table ID, Row/Col, ColumnID)
- **Toggle** bật/tắt bằng:
  - Click icon extension trên toolbar
  - Phím tắt `Alt+L`
- **ESC** để tắt (hoặc click vào banner trên cùng)

## 📦 Cài đặt

Get **Playwright Locator Inspector** from the Chrome Web Store:

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-blue?logo=google-chrome&style=for-the-badge)](https://chromewebstore.google.com/detail/ljhfbeiflidafahchgdkdofdhlnihike)

## 🎮 Cách sử dụng

| Thao tác | Kết quả |
|---|---|
| **Click icon** hoặc **Alt+L** | Bật/tắt inspector |
| **Hover** vào element | Highlight + tooltip hiện locator |
| **Click** vào element | Mở modal với các loại locator + nút Copy |
| **ESC** | Đóng modal hoặc tắt inspector |

## 📁 Cấu trúc

```
playwright-locator/
├── manifest.json      # Manifest V3 config
├── content.js         # Core logic (locator, tooltip, modal, highlight)
├── styles.css         # Dark theme styles
├── background.js      # Service worker (icon click, Alt+L)
├── icons/             # Extension icons
│   ├── icon-16.png
│   ├── icon-24.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

## 🛠 Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (content script)
- CSS (injected styles)
- No external dependencies

Copyright © 2026 by VuiZ.Net. All rights reserved.
Sản phẩm này chỉ phục vụ mục đích nội bộ.