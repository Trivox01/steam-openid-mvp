# Animated Navigation Polish v1

## الهدف والنطاق

تحسين Sidebar الحالية تدريجيًا دون تغيير الصفحات أو ترتيب التنقل أو App Shell. تشمل المرحلة التصغير والتوسيع، الحالة النشطة، tooltips، التركيز، RTL، وتقليل الحركة. لم تتغير Routes أو Steam أو SQLite أو تجربة التشغيل الأول.

## Collapse / Expand

زر دلالي يحفظ `sidebarCollapsed` عبر Settings Service. التخزين يستخدم سجل preferences الحالي بصيغة JSON ولا يحتاج migration. فشل الحفظ لا يمنع التنقل. تحت 1050px تُطبّق الكثافة المصغرة تلقائيًا، وتحت 700px يصبح العرض 68px.

الانتقال 180ms و`ease-out`. الأيقونات ثابتة، بينما تستخدم النصوص opacity وtransform وvisibility. مساحة المحتوى تستخدم المتغير نفسه `--sidebar-width` لتجنب عدم التزامن.

## الحالة النشطة

يتبع المؤشر `activePage`، وتحتفظ صفحات Game Details وAchievement Details بعنصر الصفحة الأم النشط. يجمع المؤشر خلفية هادئة مع شريط منطقي `inset-inline-start`، ويستخدم `aria-current="page"`.

## RTL والوصول

تعتمد المحاذاة على logical properties. يحتوي زر التصغير على `aria-expanded` وتسمية مترجمة. عناصر التنقل لها أسماء واضحة، tooltips تظهر عند hover أو keyboard focus، وfocus ring ظاهر.

## Reduced Motion والأداء

يلغي `prefers-reduced-motion` الانتقالات وحركة دخول الصفحات. لا توجد loops أو قياسات DOM أو تحديثات لكل frame. التنفيذ CSS transitions فقط، ولا يعيد تركيب محتوى الصفحات.

## Route transitions وحدود v1

لم يُضف Route transition جديد حفاظًا على state preservation؛ بقيت حركة الصفحات الحالية وتُعطّل مع reduced motion. لا توجد mobile drawer أو اختصارات تنقل جديدة في v1.

