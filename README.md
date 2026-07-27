# Achievement Nexus

واجهة تأسيسية لتطبيق سطح مكتب حديث لتتبع إنجازات الألعاب، مبنية باستخدام Tauri 2 وReact وTypeScript.

## التشغيل

```bash
npm install
npm run dev
```

لتشغيل نسخة سطح المكتب، ثبّت Rust ومتطلبات Tauri على Windows ثم:

```bash
npm run tauri dev
```

## النطاق الحالي

- بيانات تجريبية فقط عبر `MockPlatformProvider`.
- لا يوجد اتصال حقيقي بخدمات Steam أو PlayStation.
- مخطط SQLite مبدئي ومهيأ للتوسع.
