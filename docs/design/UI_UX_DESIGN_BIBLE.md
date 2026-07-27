# Achievement Nexus — UI/UX Design Bible v1

> الحالة: مرجع رسمي للمنتج والتصميم والواجهة  
> النطاق: نظام التصميم ومواصفات Dashboard وAll Games وGame Details  
> خارج النطاق: Steam Library Sync، إعادة تصميم الصفحات الحالية، واستخراج ألوان الصور

## 1. الرؤية البصرية للمنتج

Achievement Nexus هو سجل حي لرحلة اللاعب، وليس مجرد قائمة برامج. يجب أن تجيب كل شاشة عن واحد من ثلاثة أسئلة:

1. أين وصلت؟
2. ما الإنجاز الأقرب؟
3. ما اللعبة التي تستحق وقتك الآن؟

الرسالة المحورية للـDashboard:

- الإنجليزية: **What will you unlock next?**
- العربية: **ما الإنجاز الذي ستفتحه بعد ذلك؟**

تُعرض المكتبة كذاكرة شخصية قابلة للاستكشاف: أغلفة قوية بصريًا، تقدم واضح، ونصوص مختصرة. الإنجاز والإكمال هما التسلسل البصري الأول، بينما التشغيل والمنصة والبيانات الوصفية عوامل مساعدة.

## 2. مبادئ التصميم

1. **التقدم قبل المخزون:** أظهر الإكمال والإنجاز التالي قبل عدد العناصر.
2. **قرار واحد واضح:** كل مساحة رئيسية تملك إجراءً أساسيًا واحدًا.
3. **هدوء افتراضي:** لا حركة أو Glow دائم بلا معنى.
4. **المحتوى هو اللون:** صور الألعاب تقود الجو، لكن لا تتحكم في قابلية القراءة.
5. **الحالات جزء من التصميم:** Loading وEmpty وError ليست شاشات مؤقتة مرتجلة.
6. **سطح مكتب حقيقي:** كثافة مناسبة، لوحة مفاتيح، اختصارات، وتدرج responsive للنافذة.
7. **الوصول دون تنازل جمالي:** التباين والتركيز وتقليل الحركة متطلبات تأسيسية.
8. **اتساق قابل للقياس:** المسافات والألوان والحركة تأتي من Tokens فقط.

## 3. شخصية الواجهة

- ناضجة، مركزة، هادئة، وقريبة من أدوات اللاعبين المميزة.
- خلفيات عميقة، أسطح متعددة الطبقات، وبنفسجي محدود للهوية والإجراءات.
- الحواف مستديرة دون أن تصبح طفولية.
- النصوص مباشرة وقصيرة؛ تتجنب اللغة التسويقية داخل أدوات العمل.
- الصور واسعة وغامرة في Hero، ومنضبطة داخل البطاقات.

### الفرق عن GOG Galaxy

| المحور | Achievement Nexus | نمط مكتبات مثل GOG Galaxy |
|---|---|---|
| المركز | رحلة الإنجازات والإكمال | توحيد المكتبة والتشغيل |
| الإجراء الأهم | متابعة التقدم/الإنجاز التالي | تشغيل اللعبة/إدارة المكتبة |
| Dashboard | توصية سياقية لما يُفتح تاليًا | ملخص المكتبة والنشاط |
| البيانات | الندرة، الإكمال، الزخم | الملكية، المنصة، آخر تشغيل |
| النبرة | رفيق تقدم شخصي | مدير مكتبة شامل |

الاستلهام مسموح في جودة الصقل والكثافة وسلوك سطح المكتب، لا في نسخ التخطيط أو الأصول أو النصوص أو العلامة.

## 4. Design Tokens

المصدر التنفيذي هو `src/styles/index.css`. تستخدم المكونات أسماء دلالية، ولا تستخدم قيم ألوان منفردة.

### 4.1 الطبقات والألوان

- Canvas: `--background-canvas`
- Sidebar: `--background-sidebar`
- Surface translucent/default/elevated/subtle
- Text primary/secondary/tertiary
- Border default/interactive
- Accent primary/emphasis/subtle
- Status success/warning/error

تظل المتغيرات القديمة (`--bg`, `--panel`, `--text`...) مدعومة حاليًا، وتعمل التوكنات الدلالية كواجهة انتقال مستقرة.

### 4.2 المقاييس

- المسافات: `--space-1` حتى `--space-12`، بوحدة أساس 4px.
- الحواف: `--radius-xs/sm/md/lg/xl/2xl/round`.
- الظلال: none، subtle، card، elevated، overlay، glow.
- الخط: xs، sm، md، lg، xl، 2xl، display.
- الأسطر: tight، normal، relaxed.
- الحركة: instant 80ms، fast 140ms، standard 220ms، slow 360ms.
- المنحنيات: standard للعناصر اليومية، emphasized للدخول والخروج المهم.
- الطبقات: base، card-action، sticky، navigation، overlay، toast.
- Focus: `--focus-ring` مع outline ظاهر ومسافة 2–3px.
- Skeleton: base/highlight موحدان حسب الثيم.

### 4.3 قواعد الاستخدام

- لا تُستخدم ألوان Hex/RGB جديدة داخل مكونات المنتج.
- لون الحالة لا يكون وسيلة الإيضاح الوحيدة؛ يصاحبه نص أو أيقونة.
- `color-mix()` مقبول لبناء حالات من Tokens.
- التباين المستهدف: 4.5:1 للنص العادي و3:1 للنص الكبير وعناصر التحكم.
- في `forced-colors` تعتمد الحدود وProgress على ألوان النظام.

## 5. Dark وLight

### Dark

- ليس أسود خالصًا لكل الطبقات؛ يجب فصل Canvas وSurface وElevated.
- الصور يمكن أن تكون أكثر حضورًا، مع Overlay داكن متدرج.
- Glow خافت ومحصور حول التفاعل أو العنصر ذي الأولوية.

### Light

- لا تُستبدل الخلفيات الداكنة بأبيض واحد؛ تستخدم طبقات رمادية دافئة وحدود واضحة.
- الظلال أخف وأوسع، والحدود تحمل جزءًا أكبر من الفصل.
- البنفسجي الأقوى للإجراءات، مع تجنب نص بنفسجي منخفض التباين.

يجب اختبار كل مكون في الثيمين، ولا يُقبل مكون يعتمد على خلفية أب ثابتة.

## 6. RTL وLTR والترجمة

- يضبط التطبيق `lang` و`dir` على عنصر `html`.
- تستخدم الخصائص المنطقية: `inline-size`, `margin-inline`, `padding-inline`, `inset-inline`, و`text-align:start`.
- ترتيب المعلومات الدلالي يبقى في DOM، ويُترك اتجاه العرض للـCSS.
- لا تُعكس الشعارات أو أغلفة الألعاب أو أيقونات المنصات أو الرسوم.
- أسهم السابق/التالي تتكيف دلاليًا إذا استُخدمت، لا عبر عكس كل SVG.
- SteamID64 وAPI Key والروابط وأسماء الألعاب الأجنبية تبقى `dir="ltr"`.
- أسماء الألعاب والمطورين والناشرين والعلامات التجارية لا تُترجم.
- المحتوى الرسمي العربي يُستخدم فقط عندما يوفره المصدر.
- جميع نصوص UI تأتي من ملفات locale مع fallback إنجليزي.
- البحث والفلاتر يحافظان على ترتيب منطقي في RTL؛ ينتقل التركيز وفق ترتيب DOM المرئي.

## 7. Accessibility

- كل التفاعلات عناصر `button`, `a`, `input` أصلية.
- Focus ظاهر دائمًا للوحة المفاتيح ولا يُخفى بسبب Hover.
- الحد الأدنى للمساحة التفاعلية 40×40px، والمفضل 44×44px.
- الصور الزخرفية `alt=""`، والأغلفة ذات المعنى تحمل اسم اللعبة.
- Progress يستخدم `role="progressbar"` وقيم min/max/now.
- الحوارات تحمل `role="dialog"`, `aria-modal`, عنوانًا موصولًا، وتعيد التركيز للمُشغّل.
- الرسائل المتغيرة تستخدم `aria-live` باعتدال؛ الخطأ `role="alert"`.
- لا تعتمد حالة Locked/Completed/Rare على اللون وحده.
- يدعم التكبير 200% دون فقد وظائف أو overflow أفقي.
- ترتيب Tab يطابق الترتيب المرئي.

## 8. الأداء

- صور الأغلفة `loading="lazy"` و`decoding="async"` باستثناء Hero المرئي أولًا.
- تُحجز نسبة الصورة مسبقًا لمنع layout shift.
- لا Blur على مساحات كبيرة متحركة؛ يُستخدم على طبقات ثابتة محدودة.
- لا animation دائمة على شبكة بطاقات.
- استخراج اللون مستقبلًا عملية مرة واحدة، لا داخل render.
- لا تُخزن صور Base64 في الحالة أو SQLite.
- قوائم المكتبة تُصمم لتقبل virtualization دون تغيير عقدة البطاقة.
- يفضل transform/opacity للحركة، وتُتجنب خصائص layout.
- تستعمل skeletons بعد تأخير قصير عندما يمنع ذلك الوميض.

## 9. الأسطح والبطاقات والحوارات

### Surface

- Subtle للملخصات الثانوية.
- Default لمعظم البطاقات.
- Elevated للقوائم العائمة والحوارات.
- Hover لا يغير كل من اللون والظل والحجم معًا؛ مؤثران كحد أقصى.

### الحوارات

- Overlay من طبقة `--z-overlay`.
- عرض 360–520px حسب المحتوى.
- عنوان، وصف، وإجراءات واضحة. الإجراء الخطير على الطرف النهائي بصريًا.
- Escape يغلق عندما لا توجد عملية حرجة.
- أثناء الحفظ/الحذف تُعطل الإجراءات المتعارضة.

## 10. حالات النظام

### Loading

- Skeleton يحاكي هندسة المحتوى؛ Spinner للعمليات القصيرة ذات النطاق المحدد.
- Loader كامل الشاشة للتهيئة فقط.
- لا يُعرض Loader والمحتوى الرئيسي في الوقت نفسه إلا Overlay مقصود.

### Empty

- عنوان يصف الحالة، سبب موجز، وإجراء واحد ممكن.
- Empty بعد فلترة تختلف عن Empty library: الأولى تقترح مسح الفلاتر.

### Error

- رسالة قابلة للتصرف دون تفاصيل داخلية.
- Retry عند قابلية الاستعادة، مع بقاء البيانات القديمة إذا كانت صالحة.

### Success

- تأكيد قريب من الإجراء، قصير، ولا يحجب العمل.
- لا تستخدم Confetti للعمليات اليومية؛ يجوز لحدث إكمال 100% نادر مع reduced motion.

## 11. Responsive Desktop Layout

- التصميم المرجعي: 1920×1080.
- Wide ≥1440: Sidebar كامل، شبكات واسعة، Hero أفقي.
- Standard 1024–1439: تقليل الهوامش وعدد الأعمدة.
- Compact 760–1023: Sidebar أيقونات، بطاقات أقل، بيانات ثانوية قابلة للطي.
- Narrow 520–759: أدوات الصفحة تلتف، Grid عمود/عمودان، Hero رأسي.
- Minimum 320: لا overflow أفقي؛ الإجراءات تمتد بعرض مناسب.
- لا تستخدم breakpoints لإخفاء وظيفة أساسية؛ تُنقل أو تُختصر.

## 12. الصور والخلفيات

- Cover بنسبة 2:3، وHero artwork بنسبة تقريبية 2:1 مع مساحة محجوزة.
- `object-fit:cover` مع focal point قابل للإضافة مستقبلًا.
- Overlay Hero: داكن عند منطقة النص، وشفاف تدريجيًا باتجاه الصورة.
- fallback يحمل شكلًا وهوية هادئة دون أيقونة صورة مكسورة.
- Skeleton يظل ضمن نفس الأبعاد.
- فشل الصورة لا يعيد تخطيط الصفحة.
- لا تُستخدم الصورة الخارجية كخلفية CSS إذا احتجنا أحداث load/error؛ يستخدم `img` داخل Wrapper.

## 13. الحركة، Glow، وBlur

- Hover card: ارتفاع 2–4px خلال standard.
- Image zoom: أقصى 1.03–1.045.
- دخول الصفحات: opacity مع translate 6–10px فقط.
- Quick actions: opacity/translate، ولا تُزال من الوصول عبر لوحة المفاتيح.
- Glow يظهر عند hover/focus/selected أو كإشارة لهدف رئيسي.
- Border glow المتحرك لا يعمل إلا على البطاقة المتفاعلة.
- Blur للخلفيات الثابتة مثل Topbar/Modal، وليس لكل بطاقة.
- في `prefers-reduced-motion:reduce`: تلغى الحركة المستمرة والـzoom والارتفاع؛ تبقى تغييرات الحالة فورية.

## 14. Game Card Specification

### المعلومات

1. Cover واسم اللعبة.
2. المنصة والحالة.
3. نسبة الإكمال وشريط Progress.
4. المفتوح/الإجمالي.
5. وقت اللعب وآخر تشغيل.
6. Favorite وإجراءات سريعة.

### الحالات

- **Default:** معلومات أساسية، إجراءات ثانوية هادئة.
- **Hover:** ارتفاع خفيف، zoom محدود، Overlay أوضح، إظهار الإجراءات.
- **Keyboard focus:** نفس قابلية اكتشاف Hover مع Focus ring.
- **Selected:** Border accent ثابت و`aria-selected`.
- **Loading:** Skeleton بنفس أبعاد البطاقة.
- **Image failure:** fallback دون reflow.
- **Hidden:** خفض حضور الصورة مع Badge صريح، دون تعطيل القراءة.
- **Completed 100%:** Badge نجاح وتقدم كامل؛ Glow نجاح قصير عند الانتقال فقط.

### الحركة والأداء

- لا animation عند idle.
- Border glow على البطاقة النشطة فقط.
- اللون الديناميكي يُمرر كمتغيرات CSS محفوظة، لا يُحسب في المكون.
- الصور Lazy، ونظام Grid يسمح مستقبلًا بالـvirtualization.
- Quick actions قابلة للتركيز ولا تعتمد على pointer hover.

## 15. Dynamic Game Accent

### العقد المقترح

```ts
export interface GameAccent {
  accentPrimary: string;
  accentSecondary: string;
  accentText: string;
  backgroundDominant: string;
  source: "extracted" | "fallback";
  version: number;
}
```

العقد توثيقي في v1 ولا يُضاف لقاعدة البيانات الآن.

### القواعد

- يستخرج مرة واحدة في خدمة خلفية مستقبلية ثم يحفظ في SQLite.
- يربط باللعبة وإصدار خوارزمية لاستخراج جديد عند الحاجة.
- fallback هو Accent المنتج الحالي.
- تُعدل الألوان الناتجة لتحقيق contrast؛ لا يُستخدم dominant الخام للنص.
- `accentText` يحقق 4.5:1 فوق اللون الأساسي.
- التطبيق عبر CSS variables محلية على جذر اللعبة:
  `--game-accent-primary`, `--game-accent-secondary`, `--game-accent-text`, `--game-background-dominant`.
- الاستخدام: Glow، Progress، Focus، Hero primary action، Badges.
- لا يُستخدم لتلوين نصوص طويلة أو كل الأسطح.

## 16. All Games Page Specification

### الترتيب

1. Page Header: العنوان، العدد، وإجراء المنصة عند الحاجة.
2. Continue Playing: 1–3 ألعاب ذات زخم حديث.
3. Library Insights: الإكمال، backlog، وقت اللعب، وعدد المنصات.
4. Toolbar: Search، Filter chips، Sort، Grid/List.
5. Game Grid/List.
6. حالات Empty/Loading/Error.

### الفلاتر

All، Steam، Playing، Completed، 100%، Favorites، Backlog، Hidden.  
Installed محجوز للمستقبل ولا يظهر كخيار غير عامل.

### الفرز

Last played، Playtime، Completion، Name، Release date، Recently added.

### السلوك

- البحث محلي وفوري مع debounce فقط إذا أصبح مصدره مكلفًا.
- Escape يمسح البحث أولًا، ثم يغلق أي popover.
- `/` أو Ctrl+F داخل الصفحة يمكن أن يركز البحث إذا لم يتعارض مع النظام.
- Chips تستخدم `aria-pressed` وتدعم الأسهم داخل المجموعة عند تنفيذ roving focus.
- النتيجة تعلن عددها عبر live region دون إعلان كل ضغطة.
- في RTL يبقى اسم اللعبة الرسمي باتجاهه الطبيعي، وتتبع الأدوات اتجاه التطبيق.
- Query state يمكن حفظه في ذاكرة الجلسة داخل React فقط، وليس localStorage.

## 17. Game Details Specification

### Hero

- Background artwork مع overlay قراءة.
- Cover، العنوان الرسمي، المنصة، وقت اللعب، الإكمال.
- Favorite كإجراء ثانوي واضح.
- Open in Steam يظهر فقط عند توفر رابط صالح وبيئة Desktop.
- الإجراء الأساسي يتبع Accent اللعبة مع contrast مضمون.

### Tabs

Overview، Achievements، Activity، Statistics.

- Tabs قابلة للأسهم Home/End وفق نمط ARIA.
- تغيير Tab لا يعيد تحميل Hero.
- يمكن lazy-load محتوى Tab الثقيل مع Skeleton محلي.

### الحالات

- No artwork: fallback ديناميكي هادئ.
- No achievements: شرح أن اللعبة لا توفر إنجازات أو لم تتم المزامنة.
- Never played: إخفاء الادعاءات الزمنية وعرض دعوة للبدء.
- Offline data: Badge واضح مع آخر وقت مزامنة.
- Sync error: إبقاء البيانات القديمة وعرض Retry غير حاجب.

## 18. Dashboard Specification

### التسلسل

1. سؤال اليوم: “What will you unlock next?”
2. Continue Playing.
3. Next Achievement: أقرب إنجاز ذو سياق وندرة.
4. Recent Achievements.
5. Completion Progress.
6. Library Snapshot.
7. Activity.
8. Statistics.
9. Sync status غير مزعج.

في الشاشات الأضيق، تبقى Continue Playing وNext Achievement قبل الإحصائيات. لا تتحول Dashboard إلى شبكة مؤشرات متساوية الأهمية.

## 19. المكونات الأساسية

المكونات المعتمدة أو المضافة:

- `Surface`: طبقة دلالية بثلاث درجات ارتفاع.
- `SectionHeader`: عنوان قسم ووصف وإجراء.
- `StatusBadge`: neutral/accent/success/warning/error.
- `ProgressBar`: قيمة مقيدة ودعم ARIA.
- `Skeleton`: هندسة تحميل موحدة وتحترم reduced motion.
- `GameArtwork`: موجود ويدعم Lazy loading وfallback ومنع layout shift.
- `StateViews`: Loading/Empty/Error الحالية، وتُوحّد تدريجيًا مع هذا المرجع.
- `ProgressRing`: للحالات التي تستفيد فعليًا من العرض الدائري.

لا يُنشأ AnimatedBorder دائم. عند الحاجة يكون تأثيرًا مشروطًا على `:hover` و`:focus-visible` فقط.

## 20. Definition of Done للصفحات القادمة

- لا ألوان أو مسافات خارج Tokens.
- Dark/Light وRTL/LTR مجربة.
- لوحة المفاتيح تغطي كل إجراء.
- لا horizontal overflow عند 320px.
- صور دون layout shift وبـfallback.
- جميع النصوص في locales.
- reduced motion يلغي الحركة غير الضرورية.
- حالات loading/empty/error/success مكتملة.
- typecheck/build ناجحان، مع اختبار بصري على نافذة Tauri.

## 21. ترتيب التنفيذ المقترح

1. **Game Card foundation** مع جميع الحالات وStory/demo داخل نظام موجود فقط.
2. **All Games toolbar + Grid/List** باستخدام البطاقة، دون تغيير البيانات.
3. **Game Details Hero + Tabs shell** وربط الصور الحالية.
4. **Dashboard hierarchy** بعد ثبات Game Card وDynamic Accent contract.
5. **Dynamic Accent extraction** كمرحلة Backend/SQLite منفصلة ومهاجرة بأمان.

