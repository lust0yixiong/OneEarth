const table = (label, columns, rows) => ({kind: 'table', label, columns, rows});
const web = (body) => ({kind: 'web', label: '核查说明', body});

// These records describe product specifications and published methods, not observations.
export const regionalCases = {
  Q07: {
    title: '青藏高原西部积雪覆盖率和雪深的时空变化',
    question: '研究青藏高原西部的积雪覆盖率和雪深变化，需要哪些资料，哪些条件还未核实？',
    region: '青藏高原西部 · 论文描述范围60–80°E、30–40°N（跨国外包框）',
    needs: [
      {
        name: '积雪覆盖率',
        type: '栅格',
        product: 'MODIS/Terra MOD10C1 · Collection 6.1（候选替代）',
        status: '产品规格已核',
        detail: '已核候选为逐日、0.05°的MOD10C1雪覆盖百分比，2000-02-24起；与论文使用的NSIDC 25 km周产品不同。需检查云量、晴空比例和QA，不能据目录宣称逐像元连续。',
        url: 'https://doi.org/10.5067/MODIS/MOD10C1.061',
        source: 'NASA NSIDC DAAC · MOD10C1产品页与官方用户指南',
        tabs: [
          table('官方产品规格（非观测值）', ['项目', '已核内容'], [
            ['变量', 'Day_CMG_Snow_Cover：网格内映射的积雪陆地百分比'],
            ['单位 / 有效范围', '%；0–100'],
            ['时间粒度 / 目录时段', '逐日；2000-02-24至今（产品目录声明）'],
            ['空间粒度', '0.05°，约5 km；来源为500 m MOD10A1观测的汇总'],
            ['与原文的差异', '论文§2.2使用NSIDC北半球EASE-Grid 2.0积雪与海冰范围25 km周产品；本项是另核的候选替代'],
            ['地图空间依据', '全球经纬度网格；WGS84 / EPSG:4326；7200列×3600行'],
            ['覆盖范围', '180°W–180°E、90°S–90°N；包含青藏高原'],
            ['质量配套', 'Day_CMG_Cloud_Obscured、Day_CMG_Clear_Index、Snow_Spatial_QA'],
            ['非观测编码示例', '111：夜间；253：未映射；255：填充值，均不能作为覆盖率'],
            ['变量区分', '覆盖率是面积比例；MOD10A1的0–100 NDSI不是直接的覆盖百分比']
          ]),
          web('已直接读取NSIDC产品页及官方指南。指南第3页定义变量与编码，第8页定义网格和时段，第10–12页说明云遮挡及质量。低晴空比例表示只观测到部分地表；不能把未观测部分当成无雪。指南：https://nsidc.org/sites/default/files/mod10c1-v061-userguide_0.pdf')
        ]
      },
      {
        name: '积雪深度',
        type: '栅格',
        product: '中国雪深长时间序列数据集（1979–2025）',
        status: '产品规格已核',
        detail: '官方目录摘要列明逐日、0.25°、厘米单位及多传感器分包。官方索引已核，实时正文读取受阻；未验证跨国论文外包框内的有效范围，也未下载文件或验证逐像元连续性。',
        url: 'https://data.tpdc.ac.cn/zh-hans/data/df40346a-0202-4ed2-bb07-b65dfcda9368/',
        source: '国家青藏高原科学数据中心 · 官方目录索引摘要',
        tabs: [
          table('目录规格与分包（非观测值）', ['项目', '目录声明'], [
            ['变量 / 单位', '积雪深度 / cm；表示雪层厚度，不是覆盖面积比例'],
            ['粒度 / 文件', '逐日、0.25°；按年分包，每日yyyyddd.txt / ASCII浮点栅格'],
            ['地图空间依据', '321列×161行；左下像元中心60°E、15°N；间隔0.25°'],
            ['中心点范围', '由目录头信息计算：60–140°E、15–55°N；覆盖中国'],
            ['跨国范围限制', '矩形栅格范围不等于境外均有效；论文外包框跨国，中国雪深产品在其中的有效像元尚待检查'],
            ['坐标限制', '摘要声明经纬度投影，未据此自行认定其大地基准'],
            ['缺测标记', 'NODATA_value = -1'],
            ['SMMR / SSMI / SSMIS分包', '1979–2020'],
            ['AMSR-E分包', '2002–2011；目录明确结束于2011-09-27'],
            ['AMSR2分包', '2012–2024及2024-08至2025-11；目录明确始于2012-09-01'],
            ['跨传感器限制', '目录称已做交叉订正；因2021起SSMIS差异较大，其后不再以该传感器更新'],
            ['本次核查层级', '官方索引摘要已核；实时正文与数据文件的有效性、完整性待核']
          ]),
          web('产品标题中的1979–2025是多传感器资料的目录跨度，不等于一个传感器无间断观测。AMSR-E与AMSR2自身存在衔接空档，不应直接拼接成连续序列。文件分包的重叠、交叉订正和研究区缺测仍需在下载后检查。')
        ]
      },
      {
        name: '论文范围与共同有效时段',
        type: '矢量 / 质量掩膜',
        product: '论文§2.1研究区描述外包框与共同有效像元规则',
        status: '待补证',
        detail: '定位依据为论文§2.1的60–80°E、30–40°N描述外包框。该框跨国，不是青藏高原实际边界；中国雪深资料能否覆盖全框待核。2001–2020仅为候选共同年份。',
        url: 'https://file.scirp.org/pdf/acs_4701341.pdf',
        source: 'Naqi等（2025）§2.1–2.2；两项候选产品规格对照',
        tabs: [
          table('分析前仍需确定', ['条件', '判定要求'], [
            ['定位空间依据', '论文§2.1：60–80°E、30–40°N；仅作描述外包框'],
            ['边界含义', '该外包框跨国，不能当作青藏高原边界或已复原的论文分析掩膜'],
            ['国内产品适配', '需检查中国雪深数据在全框内的有效像元；矩形范围覆盖并不证明境外数据可用'],
            ['目录时段交集', '2001–2020为便于完整年度比较的候选期，尚非有效观测连续性的结论'],
            ['原文时段差异', '论文表1与正文对雪深写1979–2021及1979–2019，摘要分析期为1978–2020；实际输入年份待澄清'],
            ['文件级完整性', '核对逐日文件清单、缺日与传感器分包，不以起止年份替代检查'],
            ['像元级连续性', '按日联合检查云量、QA、填充值、雪深-1缺测值及共同有效像元'],
            ['网格对齐', '0.05°覆盖率与0.25°雪深须统一空间支持；重采样不能增加观测信息'],
            ['趋势与变化', '分别计算覆盖率和雪深；先定义季节、年度汇总与有效观测门槛']
          ]),
          web('已直接读取原文§2.1–2.2。本案例以§2.1描述外包框定位，展示已核候选产品与缺口，没有生成覆盖率、雪深或趋势。论文原用25 km周积雪产品，不能将本原型另核的MOD10C1逐日产品称为原始输入；也不能将跨国描述框或中国产品矩形范围视为全区有效观测。')
        ]
      }
    ],
    spatial: 'snow',
    gap: '论文60–80°E、30–40°N为跨国描述外包框，不是高原边界。中国雪深在框内的有效范围、原文时段及共同有效像元待核；MOD10C1为候选替代。覆盖率（%）与雪深（cm）分别分析，当前无变化结论。'
  },
  Q14: {
    title: '巴尔滕省陆地自然度评估',
    question: '如何按论文的六类指标，匹配土耳其巴尔滕省自然度评估所需的候选资料？',
    region: '土耳其 · 巴尔滕省（Türkiye / Bartın，TR-74）',
    needs: [
      {
        name: '研究区行政边界',
        type: '矢量',
        product: 'geoBoundaries gbOpen · TUR ADM1 · Bartın',
        status: '产品规格已核',
        detail: '已从提供方真实简化层提取Bartın（TR-74），坐标未改；代表年份2021。可用于原型定位，尚未证明与论文实际使用的边界版本相同。',
        url: 'https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM1/',
        source: 'geoBoundaries · TUR-ADM1-25984515；原始来源Open Street Map',
        tabs: [
          table('真实边界的来源记录', ['字段', '内容'], [
            ['行政单元', 'Bartın；shapeISO=TR-74；ADM1省级'],
            ['几何', 'MultiPolygon；3个多边形；324个顶点（含环闭合点）'],
            ['经纬度范围', '32.095106–32.9389811°E；41.3029432–41.8491302°N'],
            ['代表年份 / 构建日期', '2021 / 2023-12-12'],
            ['来源与版本', 'Open Street Map；geoBoundaries固定提交9469f09'],
            ['该层API许可字段', 'Creative Commons Attribution-ShareAlike 2.0'],
            ['处理记录', '从提供方简化层选取Bartın；未重画、未改动坐标'],
            ['适用限制', '原型地图边界；非测绘边界，亦非论文研究掩膜的复原']
          ]),
          web('本地bartin-boundary.json保留提供方几何与来源记录。固定下载地址：https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/TUR/ADM1/geoBoundaries-TUR-ADM1_simplified.geojson 。许可字段按该层API原样记录，未用网站通用许可覆盖来源许可。')
        ]
      },
      {
        name: '聚落密度',
        type: '矢量 → 栅格',
        product: '聚落中心点与核密度估计',
        status: '待补证',
        detail: '论文以聚落点作核密度估计；原始点数据的具体下载地址、版本与完整参数尚不明确。不能将候选OSM聚落点视为已取得的论文输入。',
        url: 'https://dergipark.org.tr/en/pub/jaes/article/1659880',
        source: 'Duran（2025）· 论文材料与方法，第294页',
        tabs: [
          table('已核方法与缺口', ['项目', '内容'], [
            ['论文因子', 'Settlement density'],
            ['输入形态 / 处理', '聚落点 / Kernel Density核密度估计'],
            ['指标方向', '聚落密度越高，论文设定的人为影响越强'],
            ['待补资料', '原始点集、日期、核函数与带宽、搜索半径、输出网格'],
            ['候选替代的边界', '可另选OSM聚落点，但须标注为替代输入并验证遗漏']
          ]),
          web('方法已见于论文全文；本项待补证的是用于复现的点数据和参数。原文PDF：https://dergipark.org.tr/en/download/article-file/4699589 。')
        ]
      },
      {
        name: '人口密度',
        type: '统计表 + 矢量 → 栅格',
        product: 'TurkStat地址人口登记资料 + 聚落Thiessen多边形',
        status: '方法已核',
        detail: '论文将TurkStat人口分配到以聚落中心生成的Thiessen多边形，按面积计算人/km²；不是直接使用行政区面积。本次尚未取得论文所用村级表。',
        url: 'https://veriportali.tuik.gov.tr/Bulten/Index?dil=1&p=Adrese-Dayali-Nufus-Kayit-Sistemi-2023-49684',
        source: '论文第294–296页；TurkStat 2023官方人口登记目录入口',
        tabs: [
          table('人口资料的匹配条件', ['项目', '内容'], [
            ['论文因子', 'Population density'],
            ['资料来源', 'TurkStat地址人口登记系统；研究区介绍引用2023年人口'],
            ['计算方式', '聚落人口 / 对应Thiessen多边形面积（km²）'],
            ['空间配对', '人口表需通过聚落标识与中心点匹配'],
            ['待核', '实际采用的村/社区表、统计日期、字段与聚落对应关系'],
            ['入口读取限制', '官方条目可定位，本次实时正文要求JavaScript；未下载原始表']
          ])
        ]
      },
      {
        name: '道路密度',
        type: '矢量 → 栅格',
        product: 'OpenStreetMap道路与加权线密度',
        status: '方法已核',
        detail: '论文使用OSM道路，并通过Google Earth高分辨率影像检查；按主要、次要等道路类别加权计算线密度。历史路网、修订内容和完整权重仍待取得。',
        url: 'https://www.openstreetmap.org/copyright',
        source: '论文第294–296页；OpenStreetMap官方入口',
        tabs: [
          table('道路因子的实际方法', ['项目', '内容'], [
            ['论文因子', 'Road density'],
            ['来源 / 核验', 'OSM道路；以Google Earth影像检查修正'],
            ['处理', '依据道路类别加权，使用Line Density线密度工具'],
            ['指标方向', '道路密度越高，论文设定的人为影响越强'],
            ['复现缺口', 'OSM快照日期、作者修订、道路权重、搜索半径与输出网格']
          ]),
          web('OSM入口可用于取得候选路网；本次没有下载或核对Bartın道路文件，也没有把当前路网当作论文所用历史路网。')
        ]
      },
      {
        name: '土地利用 / 覆盖',
        type: '分类栅格',
        product: 'Esri Sentinel-2 10 m Land Use/Land Cover',
        status: '产品规格已核',
        detail: '论文使用Esri处理的Sentinel-2土地覆盖资料并引用Esri 2021。Esri官方同类产品有10 m年度地图；具体原文所用年度文件和版本尚未匹配。',
        url: 'https://livingatlas.arcgis.com/landcover/',
        source: '论文第294页；Esri Living Atlas官方产品目录',
        tabs: [
          table('土地覆盖的来源与分类口径', ['项目', '内容'], [
            ['论文因子', 'Land cover/use'],
            ['论文资料说明', 'ESA Sentinel-2影像经Esri处理的土地覆盖资料；引用Esri 2021'],
            ['官方候选产品', 'Sentinel-2 10 m年度土地利用/覆盖地图'],
            ['论文分类口径', '聚落和农业：较高人为影响；森林：较低人为影响'],
            ['中间类型', '牧场、开阔地和稀疏植被：论文设为次一级人为影响'],
            ['待核', '实际影像年度、产品版本、下载文件和重分类规则']
          ]),
          web('这是对论文资料类别的匹配，不是确认已经取得作者原始栅格。不能因为论文引用Esri 2021，就自行认定所有输入均为2021年。')
        ]
      },
      {
        name: '植被指数 NDVI',
        type: '栅格',
        product: 'Landsat 9 · B5与B4波段',
        status: '方法已核',
        detail: '原文明确以Landsat 9计算NDVI=(B5−B4)/(B5+B4)，无量纲。可从USGS检索候选影像，但原文场景日期、影像编号及处理级别仍待补齐。',
        url: 'https://www.usgs.gov/faqs/how-do-i-search-and-download-landsat-collection-2-data-products',
        source: '论文第294页；USGS Collection 2数据入口说明',
        tabs: [
          table('原文NDVI方法（非新增观测）', ['项目', '内容'], [
            ['卫星 / 波段', 'Landsat 9；B5近红外、B4红光'],
            ['公式 / 单位', '(B5−B4)/(B5+B4)；无量纲'],
            ['论文指标方向', '较高NDVI对应论文设定的较高自然度'],
            ['官方检索入口', 'USGS EarthExplorer，可检索Collection 2并选取单独波段'],
            ['待补参数', '获取日期、场景编号、处理级别、云掩膜、反射率缩放与网格对齐']
          ]),
          web('本项按论文使用Landsat 9，未将其他传感器的NDVI当作同一输入。产品入口只证明可检索候选数据，尚未确认作者所用影像。')
        ]
      },
      {
        name: '地形粗糙度 TRI',
        type: '高程栅格 → 指数栅格',
        product: 'EU-DEM · 25 m',
        status: '产品规格已核',
        detail: '论文明确引用25 m EU-DEM，并依据邻域高程起伏计算TRI。EEA官方目录可核25 m与Türkiye覆盖，但该产品已停维护；尚未取得作者所用高程文件与精确计算参数。',
        url: 'https://www.eea.europa.eu/en/datahub/datahubitem-view/d08852bc-7b5f-4835-a776-08362e2fbf4b',
        source: '论文第294–295页；EEA EU-DEM官方目录及元数据',
        tabs: [
          table('高程资料与替代限制', ['项目', '内容'], [
            ['论文因子 / 原始资料', 'Topographic Roughness Index；25 m EU-DEM'],
            ['方法说明', '原文描述以中心像元及周围八像元的高程起伏构造TRI'],
            ['官方规格参照', 'EU-DEM v1.1：25 m GeoTIFF；分区包含Türkiye'],
            ['版本限制', '论文未明确v1.1；官方规格参照不等于已确认原文版本'],
            ['当前可用性', 'EEA将EU-DEM列为停维护 / 已替代产品；元数据仍可核查'],
            ['替代方案的边界', '若改用Copernicus DEM 30 m，须明确标为替代，不能称25 m原始输入'],
            ['待核', '原始瓦片、版本、TRI实现、邻域与归一化参数']
          ])
        ]
      },
      {
        name: '自然度合成方法',
        type: '论文 / 方法说明',
        product: 'Duran（2025）· 六因子模糊叠加模型',
        status: '方法已核',
        detail: '六因子转为模糊隶属度并叠加，假定等权，未采用AHP；自然度范围0–1。此处整理已发表的方法，未运行模型或产生自然度图。',
        url: 'https://doi.org/10.35229/jaes.1659880',
        source: 'The Naturalness Level of Terrestrial Areas in Bartin Province (Northern Türkiye) · 全文',
        tabs: [
          table('论文方法与复现状态', ['项目', '内容'], [
            ['论文', 'Celalettin Duran，2025，Journal of Anatolian Environmental and Animal Sciences，10(3)，292–300'],
            ['六个因子', '聚落密度、人口密度、道路密度、土地利用/覆盖、NDVI、TRI'],
            ['合成', '模糊隶属度转换后进行Fuzzy Overlay Model叠加'],
            ['权重', '原文明示各因子等权，未使用AHP'],
            ['模型范围', '0–1；较高值表示模型定义的较高自然度'],
            ['复现状态', '全文方法已核；原始数据与完整参数未齐，未执行计算']
          ]),
          web('已直接读取论文PDF：https://dergipark.org.tr/en/download/article-file/4699589 。第294–295页说明输入与方法，第297页说明等权及0–1范围。候选数据可用于准备研究，不足以声称复现了论文结果；自然度指标也不等同于直接观测的生物多样性。')
        ]
      }
    ],
    spatial: 'bartin',
    gap: '真实行政边界已就绪，六因子方法与候选来源已核。仍需确认聚落点、村级人口表、影像日期、历史路网、原始高程及完整模型参数；当前未生成自然度栅格，也未验证论文结果。'
  }
};
