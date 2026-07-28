# تقرير جاهزية الإصدار التجريبي المغلق

التاريخ: 28 يوليو 2026  
قرار جودة التطبيق: **GO**  
قرار حزمة `0.1.0-beta.1`: **NO-GO — لم يتوفر ملف مستخدم Windows مستقل لاختبار Clean Install**

## تحديث Clean Environment Release Acceptance

أُجريت جولة قبول مستقلة للحزمتين الجاهزتين في 28 يوليو 2026 دون تعديل الكود أو إعادة البناء:

- تطابق SHA-256 لحزمة MSI: `6FC2AC547AE2B18B13A61654668EF25D7B54F9B398FBEB9695A2B69316684F26`.
- تطابق SHA-256 لحزمة NSIS: `E8B6B95F43D44C8C9B6E0ADD8FBBEC5C099A0D511BD88CFC17F0BCA74CB9B972`.
- الهوية الفعلية للعملية: `DESKTOP-IQLBBG6\CodexSandboxOffline`.
- `USERPROFILE`: `C:\Users\SALEM`.
- `APPDATA` وKnown Folder الفعلي: `C:\Users\SALEM\AppData\Roaming`.
- `LOCALAPPDATA` وKnown Folder الفعلي: `C:\Users\SALEM\AppData\Local`.
- Windows Sandbox غير مثبت (`WindowsSandbox.exe` غير موجود).
- تعذر الوصول إلى Hyper-V بسبب سياسة صلاحيات الجهاز.

هذه البيئة ليست مستقلة: هوية Sandbox الحالية تعيد Known Folders إلى ملف SALEM الذي يحتوي بيانات Achievement Nexus الموجودة مسبقًا. وبناءً على شرط عدم استخدام قاعدة التطوير، أُوقف الاختبار قبل التثبيت ولم تُنفذ First Launch أو Steam Sync أو Restart أو Reinstall أو Uninstall في هذه الجولة.

### Release Blocker

`RA-001 · Blocker` — لا توجد Windows Sandbox أو VM أو جلسة مستخدم فعلية ذات `USERPROFILE` وAppData مستقلين يمكن الوصول إليها من بيئة الاختبار الحالية. خطوات إعادة الإنتاج:

1. شغّل `[Environment]::GetFolderPath('ApplicationData')` تحت الهوية المعزولة.
2. لاحظ أنه يعيد `C:\Users\SALEM\AppData\Roaming`.
3. لاحظ وجود `com.achievementnexus.app` وقاعدة التطوير في هذا الملف.

المعالجة المطلوبة ليست تغييرًا في التطبيق: توفير Windows Sandbox أو VM نظيفة أو تسجيل الدخول إلى حساب Windows مستقل، ثم إعادة تنفيذ مصفوفة القبول على الحزم الحالية.

## RA-002 — نافذة Console في نسخة Windows

اكتُشف أن نسخة Windows المثبتة كانت تفتح نافذة Console سوداء إلى جانب واجهة التطبيق وتعرض سجلات `eprintln!` الخاصة بتهيئة SQLite.

- السبب الجذري: غياب `windows_subsystem = "windows"` من نقطة دخول Rust، مما جعل ملف Release يحمل PE subsystem رقم `3` (`Windows Console`).
- الإصلاح: تطبيق Windows GUI subsystem على البنايات غير التجريبية فقط؛ بقي Debug دون تغيير ليستفيد المطور من السجلات.
- التحقق بعد البناء: PE subsystem أصبح `2` (`Windows GUI`).
- اختبار NSIS: التثبيت Exit 0، التطبيق مستجيب، عنوان النافذة `Achievement Nexus`، ولا توجد عملية `conhost` جديدة.
- الإزالة: Exit 0 وحُذف مجلد البرنامج المؤقت.
- أضيف تحقق انحدار داخل `test:quality` يمنع غياب توجيه GUI subsystem مستقبلًا.

حالة RA-002: **مغلق**. لا يغيّر ذلك حالة RA-001 المتعلقة بضرورة تنفيذ Clean Install وSteam Sync داخل ملف Windows مستقل.

## ملخص تنفيذي

تم تشغيل نسخة Tauri التطويرية على Windows مع قاعدة البيانات المحلية الحقيقية، وإجراء معاينة فعلية داخل نافذة التطبيق، ثم تشغيل بوابة التحقق الآلي كاملة. لم يظهر انهيار، أو خطأ SQLite، أو تحذير بناء، أو فشل اختبار.

اكتشفت الجولتان ثلاث مشكلات متوسطة: انتقال موضع التمرير بين الصفحات، وبقاء صور Steam المحمّلة من cache بشفافية صفر، وعدم إدارة تركيز حواري الحذف وإعادة الضبط. كما وُجد نقص ترجمة في أدوات Game Library العربية. تم إصلاحها وإضافة فحوص انحدار للمشكلات القابلة للفحص آليًا.

لا توجد مشكلة Blocker أو High مفتوحة. اكتملت مصفوفة اللغات والثيمات والدقات، Reduced Motion الحقيقي، Keyboard-only، ومزامنة Steam التفاعلية. جميع مشكلات Medium المثبتة أُصلحت وتحقق منها فعليًا وآليًا.

## بيئة الاختبار

- Windows Desktop، Tauri 2 development build.
- React + TypeScript + Vite.
- قاعدة SQLite الحقيقية الحالية، دون Mock mode أو مسح بيانات.
- بيانات فعلية: 34 لعبة و1,822 إنجازًا في قاعدة التطبيق وقت الجولة.
- نافذة Tauri فعلية؛ لم تُستخدم صفحة Vite في متصفح مستقل.
- لم يُطبع Steam Web API Key ولم يُحفظ في ملفات المشروع.

## ما تمت معاينته فعليًا

### الشاشات

- App Shell وTopbar وSidebar في وضعها المطوي.
- Achievement Journey / Dashboard، بما في ذلك Hero وContinue Journey وWeekly Insights وLibrary Snapshot.
- Game Details للعبة Marvel Rivals، بما في ذلك Hero وخلفية اللعبة وبيانات التقدم.
- Statistics 2.0: رأس الصفحة، الفلاتر، Overview، Completion Distribution وActivity.
- Steam Settings وGeneral/Privacy/Data settings، وشريط الحفظ الثابت.

### الثيم والدقة

- Dark وLight تمت معاينتهما فعليًا في Statistics.
- Dark تمت معاينته فعليًا في Dashboard وGame Details.
- Light تمت معاينته فعليًا في Settings.
- الدقة الفعلية الأساسية: 1366×768.

اكتملت لاحقًا معاينة System theme والعربية/RTL ومصفوفة الدقات وZoom 125% و150%، وتفاصيلها موثقة في Acceptance Matrix.

## المشكلات المكتشفة

| التصنيف | المشكلة | الحالة |
|---|---|---|
| BR-001 · Medium | انتقال موضع تمرير منطقة المحتوى من صفحة سابقة إلى صفحة جديدة، مما جعل Statistics تبدأ من منتصفها | تم الإصلاح |
| BR-002 · Medium | صور Steam المخزنة مؤقتًا قد تكون محمّلة فعليًا لكن تبقى `opacity: 0` إذا سبق `load` ربط React | تم الإصلاح والتحقق بصريًا |
| BR-003 · Medium | حوارا الحذف وإعادة الضبط لا ينقلان التركيز ولا يدعمان Escape/Focus trap/Focus restoration | تم الإصلاح والتحقق بلوحة المفاتيح |
| BR-004 · Medium | عناوين وفلاتر وترتيب Game Library كانت إنجليزية داخل الواجهة العربية | تم الإصلاح |
| BR-005 · Medium | ملخص Achievement Sync عرض placeholders حرفية بسبب عدم تطابق صيغة interpolation | تم الإصلاح والتحقق بإعادة المزامنة |

لم تُثبت مشاكل Blocker أو High أو Low/Cosmetic أخرى خلال الجزء المنفذ من المعاينة.

## تحديث Beta Acceptance Matrix

أُجريت الجولة التالية داخل WebView2 الخاص بنافذة Tauri نفسها، مع فحص DOM والحالة المرئية، وليست داخل متصفح مستقل.

| Test area | Language | Theme | Resolution | Zoom | Result | Evidence | Issue |
|---|---|---|---|---|---|---|---|
| Dashboard + Sidebar collapsed | English | Dark | 1366×768 | 100% | Passed | معاينة Tauri فعلية، لا overflow | — |
| Statistics + Settings | English | Light | 1366×768 | 100% | Passed | معاينة فعلية للتباين والرسوم وشريط الحفظ | — |
| Dashboard + Sidebar expanded | Arabic RTL | Light | 1366×768 | 100% | Passed | لقطة فعلية؛ اتجاه RTL وصور الألعاب سليمان | — |
| Dashboard + Library + Statistics | Arabic RTL | Dark | 1366×768 | 100% | Passed after fix | لا overflow؛ اكتُشف نقص ترجمة Library وأُصلح | BR-004 |
| System theme | English | System (OS Dark) | 1366×768 | 100% | Passed | `prefers-color-scheme: dark` فعّال وطبقة التطبيق Dark | — |
| Dashboard + Library + Statistics | Arabic RTL | Dark | 1920×1080 | 100/125/150% | Passed | مصفوفة viewport فعلية؛ لا horizontal overflow | — |
| Dashboard + Library + Statistics | Arabic RTL | Dark | 1600×900 | 100/125/150% | Passed | لا horizontal overflow | — |
| Dashboard + Library + Statistics | Arabic RTL | Dark | 1366×768 | 100/125/150% | Passed | لا horizontal overflow | — |
| Dashboard + Library + Statistics | Arabic RTL | Dark | 1280×720 | 100/125/150% | Passed | لا horizontal overflow | — |
| Dashboard + Library + Statistics | Arabic RTL | Dark | 900×650 | 100/125/150% | Passed | أقرب نافذة ضيقة مختبرة؛ لا horizontal overflow | — |
| First 20 Library cards | English | Dark | 1366×768 | 100% | Passed after fix | 18 cover محمّلة و2 fallback مقصودان؛ فتح العناوين الصحيحة 20/20 | BR-002 |
| Game Details: 5 games | Arabic RTL | Light | 1366×768 | 100% | Passed | Hero/cover/progress/partial/unsupported/long title وempty achievements | — |
| Statistics filters | English | System/Dark | 1366×768 | 100% | Passed | All/Completed/In progress/Not started/Favorites؛ Favorites أعطى empty state صريحًا | — |
| Keyboard: Sidebar focus order | English | System/Dark | 1366×768 | 100% | Passed | Tab مرّ بالمسارات بالترتيب مع focus مرئي | — |
| Keyboard: Settings dialogs | English | System/Dark | 1366×768 | 100% | Passed after fix | نقل focus إلى Cancel، Escape أغلق الحوار، واستعاد focus إلى Delete data | BR-003 |
| Reduced Motion runtime | English | Dark | 1366×768 | 100% | Passed | تشغيل WebView2 بـ`--force-prefers-reduced-motion`؛ `matchMedia=true` وصفر animations فعالة في جميع الصفحات وOnboarding | — |
| Steam interactive sync | English | Dark | 1366×768 | 100% | Passed | Library: 34/0/0/34/0؛ Achievements: 11 completed، 0 failed، 9 unsupported، 1 no schema | BR-005 |
| WebView console/network observation | English | Dark | 1366×768 | 100% | Passed | صفر console/error/unhandled-rejection events أثناء الجلسة؛ لا مفتاح في السجلات | — |
| Keyboard-only full routes | English | Dark | 1366×768 | 100% | Passed | Tab/Shift+Tab/Enter/Space/Escape/Arrows/Ctrl+F والحوار وSync | — |

### أول 20 لعبة

| # | اللعبة | AppID | Artwork | فتح التفاصيل |
|---|---|---:|---|---|
| 1 | PUBG: BATTLEGROUNDS | 578080 | Loaded | صحيح |
| 2 | Warframe | 230410 | Loaded | صحيح |
| 3 | Company of Heroes 2 | 231430 | Loaded | صحيح |
| 4 | Super Sus | 2920270 | Loaded | صحيح |
| 5 | Predecessor | 961200 | Loaded | صحيح |
| 6 | The Seven Deadly Sins: Origin | 3679080 | Fallback | صحيح |
| 7 | Vampire: The Masquerade - Bloodhunt | 760160 | Loaded | صحيح |
| 8 | Tom Clancy's Rainbow Six Siege | 359550 | Loaded | صحيح |
| 9 | Overwatch® | 2357570 | Loaded | صحيح |
| 10 | Call of Duty® | 1938090 | Loaded | صحيح |
| 11 | Conqueror's Blade | 835570 | Loaded | صحيح |
| 12 | Battlefield™ 6 | 2807960 | Loaded | صحيح |
| 13 | Marvel Rivals | 2767030 | Loaded | صحيح |
| 14 | Where Winds Meet | 3564740 | Loaded | صحيح |
| 15 | Black Desert | 582660 | Loaded | صحيح |
| 16 | ARC Raiders Playtest | 2427520 | Loaded | صحيح |
| 17 | Wuthering Waves | 3513350 | Fallback | صحيح |
| 18 | MIR4 | 1623660 | Loaded | صحيح |
| 19 | NARAKA: BLADEPOINT | 1203220 | Loaded | صحيح |
| 20 | BLOODSTRIKE | 3199170 | Loaded | صحيح |

الـfallback المقصود ظهر للعبتي **The Seven Deadly Sins: Origin** و**Wuthering Waves** فقط، دون أيقونة صورة مكسورة أو تغيير في أبعاد البطاقة.

### عينة Game Details

- PUBG: BATTLEGROUNDS: 37 إنجازًا، حالة Partial، Hero وcover محمّلان.
- Company of Heroes 2: 452 إنجازًا، حالة Partial، قائمة كبيرة سليمة.
- The Seven Deadly Sins: Origin: Unsupported و0 إنجاز؛ empty state صريح.
- Wuthering Waves: Unsupported مع artwork fallback.
- Vampire: The Masquerade - Bloodhunt: عنوان طويل، Partial، 35 إنجازًا، دون overflow.

### Keyboard وReduced Motion

تم إثبات Tab وShift+Tab، فتح الصفحات بـEnter وSpace، فتح اللعبة بالكيبورد، Ctrl+F داخل Game Details، تغيير density بالأسهم، تشغيل Sync، حبس التركيز في الحوار، Escape، واستعادة التركيز.

تم تشغيل WebView2 فعليًا بخيار `--force-prefers-reduced-motion`. أعاد `matchMedia("(prefers-reduced-motion: reduce)")` القيمة `true`، ولم تبق أي animation فعالة في Dashboard أو Library أو Achievements أو Activity أو Statistics أو Settings أو Game Details أو Onboarding.

## الإصلاح المنفذ

تم ربط عنصر `main` بمرجع، وإعادة موضع التمرير إلى أعلى الصفحة عند:

- التنقل بين صفحات Sidebar.
- فتح Game Details.
- فتح Achievement Details.

تم الحفاظ على موضع التمرير عند الرجوع للخلف عمدًا، لأنه يمثل سياق المستخدم السابق. أضيف فحص انحدار إلى `test:navigation` للتأكد من وجود مرجع منطقة المحتوى واستدعاء إعادة التمرير.

الملفات المعدلة لهذا الإصلاح:

- `src/App.tsx`
- `scripts/validate-navigation.mjs`

## النتائج البصرية

- لا يوجد overflow أفقي أو تداخل Sidebar/Topbar ظاهر في اللقطات التي تمت عند 1366×768.
- تباين Statistics وبطاقاتها ورسومها واضح في Dark وLight.
- Hero في Achievement Journey واضح، وبطاقات Continue Journey حافظت على نسب الأغلفة.
- Game Details عرض خلفية ديناميكية صحيحة مع Overlay مقروء.
- Settings حافظت على المحاذاة وشريط الحفظ الثابت دون تغطية المحتوى في اللقطات العليا والسفلى.
- عُممت النتائج عبر مصفوفة RTL/LTR وDark/Light/System والدقات والتكبير الموثقة أعلاه.

## Game Library وGame Details

- قاعدة البيانات تحتوي 34 لعبة حقيقية ولا تعتمد الواجهة داخل Tauri على Mock fallback.
- عُرضت أغلفة فعلية متعددة في Continue Journey دون تشوه ظاهر.
- اكتملت مراجعة أول 20 بطاقة وفتح التفاصيل الصحيحة 20/20.
- تمت معاينة خمس ألعاب متنوعة تشمل 452 إنجازًا وPartial وUnsupported وfallback وعنوانًا طويلًا.
- fallbacks الموثقة: The Seven Deadly Sins: Origin وWuthering Waves.

## Statistics 2.0

- تمت معاينة الرأس والفلاتر ومقاييس Overview والتوزيع والنشاط في Tauri.
- القيم الظاهرة كانت من البيانات الحقيقية، ومنها 34 لعبة و1,822 إنجازًا.
- التباين والحدود والرسوم سليمة بصريًا في Dark وLight عند 1366×768.
- تم اكتشاف مشكلة التمرير عند الدخول إلى الصفحة وإصلاحها، ثم تأكيد ظهور رأس الصفحة بعد التنقل.
- اكتملت RTL وZoom 150% وجميع الفلاتر، بما فيها Favorites empty state.

## Steam Sync

تم إدخال API Key من الواجهة دون كشفه أو حفظه في المشروع.

- Library Sync: 34 fetched، 0 added، 0 updated، 34 unchanged، 0 skipped.
- بعد Library Sync: 34 لعبة و34 AppID فريدًا و1,822 إنجازًا؛ لا تكرار ولا حذف.
- Achievement Sync النهائي: 11 completed، 0 failed، 9 unsupported، 1 no-schema، 1,104 achievement unchanged في نتيجة الجولة.
- بعد Achievement Sync: بقيت 34 لعبة فريدة و1,822 إنجازًا محفوظًا.
- Retry Failed Games لم يظهر لأن عدد الأخطاء المؤقتة صفر. هذا هو السلوك الصحيح: الزر لا يظهر ولا يعيد unsupported/no-schema. يغطي `test:steam-achievements` سياسة retry للأخطاء المؤقتة فقط.
- فصل نجاح المكتبة عن الحالات الجزئية للإنجازات ظهر بوضوح.

## Accessibility وKeyboard وReduced Motion

- تحقق `test:navigation` من `aria-current` و`aria-expanded` وبنية Sidebar.
- تحقق `test:quality` من 471 مفتاح ترجمة.
- فحص المصدر يؤكد وجود معالجة `prefers-reduced-motion`.
- اكتملت جولة Keyboard-only للأوامر المطلوبة والمسارات الرئيسية.
- اكتمل Reduced Motion فعليًا عبر خيار WebView2 الأصلي، وشمل Onboarding.

## Console وLogs

- جلسة Tauri فتحت وعرضت البيانات دون خطأ SQLite أو شاشة خطأ.
- لم تظهر أخطاء بناء أو Rust في بوابة التحقق.
- لم يُطبع أو يُسجل API Key.
- تم تركيب مراقبة console/error/unhandled-rejection قبل المزامنة؛ النتيجة صفر أحداث.
- لم يظهر SQL خام أو React warning أو duplicate key أو retry loop أو image fallback loop.

## نتائج بوابة التحقق

| الفحص | النتيجة |
|---|---|
| `npm run typecheck` | Passed |
| `npm run build` | Passed، 2,076 module |
| `npm run test:quality` | Passed، 471 locale key |
| `npm run test:navigation` | Passed |
| `npm run test:onboarding` | Passed |
| `npm run test:steam-library` | Passed، 20 assertion |
| `npm run test:steam-achievements` | Passed، 21 assertion |
| `npm run test:game-details` | Passed، 18 assertion |
| `npm run test:statistics` | Passed، 20 assertion |
| `npm run test:intelligence` | Passed، 11 case |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Passed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Passed، 12 test |
| `git diff --check` | Passed؛ تحذيرات CRLF معلوماتية فقط |

## المخاطر والمتطلبات المؤجلة

لا توجد بنود قبول Beta متبقية. Retry لم يكن قابلًا للتنفيذ لأن المزامنة لم تنتج أي خطأ مؤقت، وتم قبول ذلك كسلوك صحيح بدل تصنيع فشل شبكي أو تغيير بيانات المستخدم.

## قرار جودة Beta

**GO للإصدار التجريبي المغلق.**

لا توجد Blocker أو High، وجميع مشكلات Medium المثبتة مغلقة. اكتملت RTL وKeyboard-only وReduced Motion والدقات والتكبير وأول 20 لعبة ومزامنة Steam التفاعلية، وبقيت البيانات محفوظة دون تكرار. المشروع مؤهل لإصدار Beta مغلق ضمن النطاق الحالي.

هذا القرار يخص جودة التطبيق في جلسة Tauri التطويرية السابقة. لا يغيّر قرار حزمة `0.1.0-beta.1` أعلاه: **NO-GO** حتى ينجح Clean Environment Release Acceptance في ملف Windows مستقل.
