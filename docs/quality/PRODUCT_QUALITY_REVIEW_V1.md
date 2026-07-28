# Product Quality Review Sprint v1

## النطاق

شملت المراجعة First Launch، App Shell، Sidebar، Dashboard وAchievement Journey، المكتبة، Game Details 2.0، Achievements، Statistics، إعدادات Steam والإعدادات العامة، إضافة إلى حالات Empty/Error وCSS والترجمة. لم تتغير Routes أو Steam APIs أو SQLite أو قواعد Intelligence.

## المشكلات المكتشفة والإصلاحات

| التصنيف | المشكلة | الإجراء |
|---|---|---|
| High | Statistics كانت تعرض مقارنة شهرية `+4.2%` غير مشتقة من البيانات | أزيلت القيمة المختلقة واستبدلت بوصف صادق |
| High | Statistics أعادت صفحة فارغة عند غياب الألعاب | أضيفت Empty State مترجمة |
| Medium | Statistics احتوت نصوصًا إنجليزية صلبة وأرقامًا غير محلية | أضيف قاموس en/ar وتنسيق `Intl.NumberFormat` و`dir="auto"` للأسماء |
| Medium | رسالة فشل Statistics مررت خطأ المستودع الخام | استبدلت برسالة منتج مترجمة |
| Medium | selector عام في RTL ألغى transform لكل SVG | أزيل selector الخطِر؛ بقيت قواعد RTL محلية |
| Medium | فلاتر وView في Game Details لم تعلن الحالة لقارئ الشاشة | أضيف `aria-pressed` |
| Low | لم يكن هناك تحقق موحد لتكافؤ locale keys والحالات الأساسية | أضيف `test:quality` |

## الاتساق البصري وThemes

لم تُجر إعادة تصميم. بقيت Design Tokens الحالية للمسافات والحواف والحالات. لا توجد نتيجة QA بصرية لأن Tauri لم يُشغّل، لذلك يلزم التحقق من Light/Dark/System والمقاسات والـZoom قبل اعتماد Beta.

## RTL والترجمة

يتحقق الاختبار من تكافؤ مفاتيح en/ar. المصطلحات المعتمدة:

- Achievement = إنجاز
- Unlocked = مفتوح
- Locked = مقفل
- Sync = مزامنة
- Library = المكتبة
- Journey = الرحلة
- Unknown = غير معروف
- Partial = جزئي

أسماء الألعاب والإنجازات وSteam لا تُترجم، وتستخدم `dir="auto"` في المواضع التي عولجت.

## Accessibility

تمت مراجعة landmarks والأزرار الفعلية و`aria-current` و`aria-expanded` وReduced Motion. أضيفت حالات الضغط الدلالية في Toolbar. ما زال اختبار قارئ شاشة فعلي وFocus restoration الكامل للـdialogs يحتاج جولة Tauri يدوية.

## الأداء وسلامة البيانات

لم تُضف تحسينات دقيقة غير مقاسة. بقيت قائمة Game Details تدريجية بمقدار 120، والبطاقات memoized، والتحليل memoized، ومستمع Ctrl/Cmd+F يُنظف عند unmount. يؤكد الاختبار أن Unknown لا يتحول إلى Locked وأن الندرة المفقودة لا تصبح صفرًا، وأن الإكمال لا يُحفظ قبل الخطوة النهائية.

## Error وEmpty States

تم إصلاح Statistics الفارغة ورسالة خطئها. حالات Steam وGame Details الحالية تميّز private/unsupported/partial/never synced دون عرض أخطاء Rust الخام. لم يُنفذ اختبار Steam حي.

## المؤجل والمخاطر

- **Medium:** اختبار focus trap واستعادة التركيز في جميع dialogs يحتاج تشغيلًا تفاعليًا وأداة وصول.
- **Medium:** اختبار overflow وsticky/tooltips عند Zoom 125% و150% يحتاج QA بصريًا.
- **Low:** CSS التاريخي يحتوي قواعد physical قديمة تعقبها overrides منطقية؛ تنظيفها الشامل مؤجل لتجنب regression.
- **Low:** قياسات React/GPU/CPU غير متاحة ولم يُدّع تنفيذها.

## قرار الجاهزية

لا توجد Blockers مكتشفة آليًا. التطبيق جاهز للانتقال إلى Statistics 2.0 من ناحية البناء والحالات المنطقية، وقريب من Beta، لكن Beta sign-off يتطلب جولة Tauri بصرية ولوحة مفاتيح وقارئ شاشة، إضافة إلى Rust tests عند توفر Cargo.
