import type { EvidenceTab, Need, SourceProfile } from "../../domain/types";
import september from "./september-sea-ice-pdo.json";

interface Source {
  extent?: "world";
  datasetId: string;
  product: string;
  source: string;
  url: string;
  type: string;
  coverage: string;
  access: string;
  years?: SourceProfile["years"];
  role?: SourceProfile["role"];
  spatial?: SourceProfile["spatial"];
}

function need(
  name: string,
  product: Source,
  use: string,
  limitation: string,
  tabs: EvidenceTab[] = [],
): Need {
  const {
    datasetId,
    source,
    url,
    type,
    coverage,
    access,
    role = "data",
    spatial = "coverage",
  } = product;
  const status = tabs.some((t) => t.kind === "table")
    ? "已读时间序列"
    : {
        data: "产品目录",
        index: "指数目录",
        request: "受限资料申请",
        method: "方法文档",
        derived: "派生量说明",
      }[role];
  return {
    name,
    datasetId,
    product: product.product,
    source,
    url,
    type,
    status,
    detail: use + limitation,
    profile: {
      role,
      spatial,
      coverage,
      access,
      limitation,
      years: product.years,
      extent: product.extent,
    },
    tabs: [
      ...tabs,
      { kind: "web", label: "来源与用途", body: use + "\n" + coverage, url },
    ],
  };
}

function modis(
  code: string,
  label: string,
  coverage: string,
  years?: SourceProfile["years"],
): Source {
  return {
    datasetId: "nasa:" + code + ".061",
    years,
    product: code + " · " + label,
    source: "NASA LP DAAC",
    url: "https://doi.org/10.5067/MODIS/" + code + ".061",
    type: "栅格",
    coverage,
    access:
      "通过 Earthdata Search 或 AppEEARS 选择瓦片、日期及字段，登录 Earthdata 下载。",
  };
}
const chirps: Source = {
  datasetId: "chc:chirps-v2",
  years: [1981, 2026],
  product: "CHIRPS v2 · 陆地降水",
  source: "UC Santa Barbara Climate Hazards Center",
  url: "https://www.chc.ucsb.edu/data/chirps",
  type: "栅格",
  coverage: "1981 年起，50°S–50°N 陆地，0.05° 网格。可按日或月取降水。",
  access:
    "从中心数据目录选择 CHIRPS-2.0 及日/月累计量，按年下载。跨期分析固定产品版本。",
};
const ndvi = modis(
  "MOD13Q1",
  "NDVI / EVI",
  "Terra 全球陆地，250 m、16 天合成，2000 年起。",
  [2000, null],
);
const era5land: Source = {
  datasetId: "cds:reanalysis-era5-land",
  years: [1950, null],
  product: "ERA5-Land hourly",
  source: "Copernicus C3S / ECMWF",
  url: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land",
  type: "栅格",
  coverage: "1950 年起的全球陆面逐小时再分析，CDS 规则网格为 0.1°。",
  access: "登录 CDS，接受条款，按区域、变量和时段分批下载。",
};
const pressure: Source = {
  datasetId: "cds:era5-pressure-levels", extent: "world",
  years: [1940, null],
  product: "ERA5 · 逐小时气压层",
  source: "Copernicus C3S / ECMWF",
  url: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels",
  type: "栅格",
  coverage: "1940 年起，全球 0.25° 规则网格，逐小时、37 个气压层可选。",
  access:
    "在 CDS 登录并接受条款，选择大气变量、区域、层次及 UTC 时次。WPS 通常选 GRIB。",
};
const surface: Source = {
  datasetId: "cds:era5-single-levels", extent: "world",
  years: [1940, null],
  product: "ERA5 · 单层与土壤场",
  source: "Copernicus C3S / ECMWF",
  url: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels",
  type: "栅格",
  coverage: "1940 年起，全球逐小时。大气和陆面变量的 CDS 规则网格为 0.25°。",
  access: "登录 CDS，选取与气压层同一时刻、范围的地面与土壤变量，按月分包。",
};
const s2: Source = {
  years: [2015, null],
  datasetId: "copernicus:sentinel-2-l2a",
  product: "Sentinel-2 L2A · 地表反射率",
  source: "Copernicus Data Space",
  url: "https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2",
  type: "影像",
  coverage:
    "Sentinel-2 任务始于 2015 年；红光 B04、近红外 B08 分辨率 10 m。所选位置的 L2A 场景和有效日期须按归档核对。",
  access:
    "用 Data Space Browser 筛日期、云量和 L2A 场景，登录后取波段与场景分类层。",
};
const fluxnet: Source = {
  datasetId: "fluxnet:2015",
  years: [1991, 2014],
  product: "FLUXNET2015 · 涡动相关塔通量",
  source: "FLUXNET",
  url: "https://fluxnet.org/data/data-availability/",
  type: "站点",
  coverage: "多国通量塔，各站在 1991–2014 年内的观测年限不同。",
  access:
    "在站点—年份表定位站号，核对数据使用条款及 FULLSET 变量，选择所需时间尺度。",
};
const wpsUrl =
  "https://www2.mmm.ucar.edu/wrf/site/documentation/users_guide/wps.html";
const q10Paper = "https://gmd.copernicus.org/articles/13/1959/2020/";
const q15Paper = "https://doi.org/10.1016/j.envint.2023.107849";
const q11Paper = "https://www.nature.com/articles/s41598-022-11619-5";
export const septemberSources = {
  extent:
    "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv",
  pdo: "https://psl.noaa.gov/pdo/data/pdo.timeseries.sstens.csv",
};

interface Guide {
  region: string;
  gap: string;
  needs: Need[];
}
export const sourceGuides: Record<string, Guide> = {
  Q01: {
    region: "科索沃 Rahovec 葡萄酒产区",
    gap: "先确定葡萄园边界和生长季，将 CHIRPS 与 ET 累计到同一月。P−ET 只能表示简化气候收支，完整水量平衡还需径流、灌溉和储量变化。",
    needs: [
      need(
        "地表温度",
        modis(
          "MOD11A2",
          "昼夜地表温度",
          "全球陆地，1 km、8 天合成，2000 年起。",
        ),
        "分别提取昼夜 LST 判断热暴露。",
        "按 QC、缩放系数和云掩膜处理，晴空地表温度与近地气温口径不同。",
      ),
      need(
        "降水",
        chirps,
        "累计生长季降水，比较旱年与常年。",
        "网格尺度大于多数葡萄园，山区宜用雨量站交叉核对。",
      ),
      need(
        "水分平衡",
        modis(
          "MOD16A2GF",
          "实际与潜在蒸散",
          "全球植被陆地，500 m、8 天累计。年末最后一个周期可短于 8 天。",
        ),
        "取实际蒸散 ET 与降水统一为毫米，按月估算 P−ET。",
        "区分实际 ET 与潜在 PET，按质量位与缩放系数处理。跨月合成需说明分配方式。",
      ),
    ],
  },
  Q03: {
    region: "热带稀树草原样区，地点由样地调查确定",
    gap: "用同一调查季节和样地缓冲范围提取生境变量。物种、捕获努力及调查位置须另取，树冠比例本身不能给出物种丰富度。",
    needs: [
      need(
        "植被覆盖度",
        modis(
          "MOD44B",
          "植被连续场 VCF",
          "全球陆地，250 m、年度树冠、非树植被与裸地百分比。",
        ),
        "区分木本与非木本覆盖，描述稀树草原结构。",
        "样方与像元面积不同，在缓冲区统计各覆盖分量并检查质量标记。",
      ),
      need(
        "植被指数",
        ndvi,
        "提取样地周围 NDVI/EVI 的生长季峰值和季节幅度。",
        "剔除云、低质量和受火扰动样本，匹配同一调查季。",
      ),
      need(
        "土地利用",
        {
          datasetId: "cds:satellite-land-cover",
          product: "ESA CCI / C3S · 年度土地覆盖",
          source: "Copernicus C3S / ESA",
          url: "https://cds.climate.copernicus.eu/datasets/satellite-land-cover",
          type: "栅格",
          coverage: "1992 年起，全球 300 m 年度土地覆盖分类。",
          access: "登录 CDS，按年份取得分类图及类别表。",
        },
        "识别草地、农地与林地的景观格局。",
        "土地覆盖是土地利用的代理变量。放牧强度和地块实际用途需独立调查。",
      ),
      need(
        "火扰动对照",
        modis(
          "MCD64A1",
          "烧毁面积与燃烧日期",
          "全球陆地，500 m 月产品，包含年内燃烧日期与质量信息。",
        ),
        "按调查季统计火烧面积或距上次燃烧的时间。",
        "小火、云下燃烧及边界像元可能漏检。",
      ),
    ],
  },
  Q04: {
    region: "朝鲜半岛，重点对照韩国浦项",
    gap: "先取同一年月和站点的地表与探空值，再取卫星过境、再分析同层资料。OMI 与 CAMS 可作替代，原论文还列出 MLS 和 MERRA-2 来源。对齐 UTC、气压/海拔和单位，检验季风期有效样本量。",
    needs: [
      need(
        "地面臭氧",
        {
          datasetId: "airkorea:surface-ozone",
          product: "AirKorea · 地面 O₃",
          source: "韩国 AirKorea",
          url: "https://www.airkorea.or.kr/web/pastSearch?pMENU_NO=123",
          type: "站点",
          coverage: "韩国地面空气质量站，覆盖和有效小时因站而异。",
          access:
            "从 AirKorea 历史资料选站点、日期及 O₃，核对站点迁移和下载字段。",
        },
        "用于夏季风前后近地面臭氧比较。",
        "地面站只有近地层读数，需另配高度剖面。",
      ),
      need(
        "臭氧探空",
        {
          datasetId: "woudc:ozonesonde",
          product: "WOUDC · Ozonesonde 臭氧探空",
          source: "WMO / WOUDC",
          url: "https://doi.org/10.14287/10000008",
          type: "垂直剖面",
          coverage: "按站和放球日期归档，原论文在韩国浦项比较探空。",
          access:
            "通过 WOUDC 选 Ozonesonde、Pohang 和时间段，下载逐次探空文件。",
        },
        "按气压或高度分层作垂直参考。",
        "放球并非逐小时连续；先确定有效剖面及其发放时刻。",
      ),
      need(
        "卫星廓线",
        {
          datasetId: "nasa:omo3pr.003",
          product: "OMI/Aura OMO3PR v003 · 臭氧廓线",
          source: "NASA GES DISC",
          url: "https://data.nasa.gov/dataset/omi-aura-ozone-o3-profile-1-orbit-l2-swath-13x48km-v003-omo3pr-at-ges-disc-37737",
          type: "垂直剖面",
          coverage: "全球日照条件下过境，天底点像元约 13 × 48 km。",
          access: "由 NASA 产品页进入 Earthdata，按日期、轨道及范围筛文件。",
        },
        "与放球日匹配并比较卫星层平均臭氧。",
        "检查云、行异常及垂直灵敏度，按产品平均核处理探空后再比较。",
      ),
      need(
        "化学再分析",
        {
          datasetId: "ads:cams-eac4", extent: "world",
          years: [2003, null],
          product: "CAMS EAC4 · 全球化学再分析",
          source: "Copernicus CAMS / ECMWF",
          url: "https://ads.atmosphere.copernicus.eu/datasets/cams-global-reanalysis-eac4",
          type: "栅格",
          coverage: "2003 年起，全球 0.75°，每 3 小时，有气压层臭氧。",
          access: "在 ADS 登录并接受条款，下载 O₃ 及指定气压层。",
        },
        "补充大尺度季风环流下臭氧分层背景。",
        "网格平均会平滑局地峰值，质量混合比与探空体积混合比须换算。",
      ),
    ],
  },
  Q05: {
    region: "美国太平洋岛屿与加勒比珊瑚礁调查区",
    gap: "先按海盆、调查协议、样带面积与幼体定义计算密度，再取调查前环境累积量。原论文研究中西太平洋，扩展至加勒比需核对当地调查协议。",
    needs: [
      need(
        "幼体调查",
        {
          datasetId: "noaa:ncrmp-pacific-juvenile",
          product: "NCRMP · 太平洋幼体与成体珊瑚样带",
          source: "NOAA Pacific Islands Fisheries Science Center",
          url: "https://www.fisheries.noaa.gov/inport/item/71550",
          type: "观测表",
          coverage: "2013 年起的美国太平洋调查岛区，分层随机样带。",
          access: "从 InPort 的分发链接取样带表、变量字典和调查协议。",
        },
        "按调查面积将幼体数量换算为密度。",
        "成体覆盖率无法给出单位面积幼体数。核对幼体大小阈值、水深、样带宽度和调查轮次。",
      ),
      need(
        "海表温度",
        {
          datasetId: "noaa:oisst-v2.1",
          years: [1981, null],
          product: "OISST v2.1 · 日海表温度",
          source: "NOAA NCEI",
          url: "https://www.ncei.noaa.gov/products/optimum-interpolation-sst",
          type: "栅格",
          coverage: "1981 年起，全球海洋日值，0.25°。",
          access: "在 NCEI 下载日网格或截取研究海域的 NetCDF。",
        },
        "表征调查周围海域的温度背景。",
        "浅礁受陆地混合与深度差异影响，现场水温用于局地校验。",
      ),
      need(
        "热应激",
        {
          datasetId: "noaa:crw-dhw-v3.1",
          product: "Coral Reef Watch · Degree Heating Week",
          source: "NOAA Coral Reef Watch",
          url: "https://www.coralreefwatch.noaa.gov/product/5km/index_5km_dhw.php",
          type: "栅格",
          coverage: "全球海洋逐日 5 km 热应激产品，DHW 以 °C·周表示。",
          access: "从 5 km 产品页进入历史数据下载，选调查日前时间窗。",
        },
        "比较珊瑚幼体密度与累积热应激。",
        "DHW 是滚动累积量，勿再次作为日值求和；它不能直接表征白化或死亡。",
      ),
      need(
        "叶绿素",
        {
          datasetId: "nasa:modis-aqua-chlor-a",
          product: "MODIS Aqua · 海色叶绿素 a",
          source: "NASA Ocean Biology Processing Group",
          url: "https://oceandata.sci.gsfc.nasa.gov/l3/",
          type: "栅格",
          coverage: "Aqua 海色观测，按时段生成全球可用海洋像元的 L3 合成。",
          access:
            "在 L3 Browser 选 Aqua-MODIS、Chlorophyll concentration、时段和分辨率。",
        },
        "表征水柱生产力环境。",
        "浅水底部反射、浑水和云会干扰反演，须筛质量和岸边混合像元。",
      ),
      need(
        "加勒比幼体协议",
        {
          datasetId: "noaa:ncrmp-atlantic-protocol",
          product: "NCRMP · 加勒比样带采样协议",
          source: "NOAA NCRMP",
          url: "https://www.coralreef.noaa.gov/topics/national-coral-reef-monitoring-program/protocols",
          type: "方法文档",
          role: "method",
          spatial: "nonspatial",
          coverage: "适用于协议中所列美国大西洋及加勒比调查辖区和轮次。",
          access:
            "选择 Atlantic coral demographics 协议，再按 Puerto Rico 或 U.S. Virgin Islands 检索对应年度的 NCRMP 归档。",
        },
        "核对不同海盆的幼体计数、物种选择与采样面积。",
        "当地样带原表须再取。跨协议比较宜保留各自的分母与类群。",
      ),
      need(
        "加勒比样带调查",
        {
          datasetId: "noaa:ncrmp-benthic-pr",
          product: "NCRMP · 波多黎各珊瑚底栖与种群调查",
          source: "NOAA NCEI / NCCOS",
          url: "https://doi.org/10.7289/V5PG1Q23",
          type: "观测表",
          coverage: "波多黎各近岸珊瑚礁的分层随机调查，按航次与年份分别归档。",
          access:
            "从集合中选年份与 Coral Demographic 表，核对对应轮次协议和幼体字段。",
        },
        "按当地调查协议查找幼体计数和样带面积，再与太平洋调查对照。",
        "点截法 LPI 表报告的是覆盖率，先核实选定年份是否实际记录幼体，再计算可比密度。",
      ),
    ],
  },
  Q06: {
    region: "格陵兰冰盖粒雪区",
    gap: "以 CARRA 气象量驱动粒雪模式，用独立密度、温度剖面约束储水空间。升温/降温试验须统一基准期、积累条件与初始化。",
    needs: [
      need(
        "气象驱动",
        {
          datasetId: "cds:carra-single-levels",
          years: [1991, null],
          product: "CARRA · 北极区域再分析",
          source: "Copernicus C3S",
          url: "https://cds.climate.copernicus.eu/datasets/reanalysis-carra-single-levels",
          type: "栅格",
          coverage:
            "1991 年起，西区含格陵兰。2.5 km，3 小时分析及逐小时短期预报。",
          access: "在 CDS 登录，选 West domain 和气温、降水、辐射等变量。",
        },
        "驱动粒雪能量和质量平衡。",
        "区分分析与预报累积量，并检查降雪/降雨相态和海拔偏差。",
      ),
      need(
        "密度与温度剖面",
        {
          datasetId: "sumup:2024",
          product: "SUMup 2024 · 密度与次表层温度",
          source: "SUMup / DTU Research Database",
          url: "https://orbit.dtu.dk/en/datasets/ab5259d2-f4fe-4920-8b55-781de475ddfa/",
          type: "垂直剖面",
          coverage: "格陵兰与南极冰盖的多次现场采样，密度和温度分属不同记录。",
          access:
            "按归档 DOI 下载，筛冰盖、坐标、深度和年份，保留原始贡献者引用。",
        },
        "对照粒雪剖面温度、孔隙随深度的变化。",
        "未确认密度和温度同钻孔同期采得，避免把不配对的层值当同一剖面。",
      ),
      need(
        "独立验证",
        modis(
          "MCD43A3",
          "地表反照率",
          "全球陆地，500 m 日产品，以约 16 天观测窗口反演。",
        ),
        "核对融化季地表反照率及辐射输入。",
        "云雪及极夜影响可用性。反照率只约束表层能量过程，内部储水仍需钻孔观测。",
      ),
      need(
        "模拟实验对照",
        {
          datasetId: "zenodo:10069583",
          product: "格陵兰粒雪增温/降温模拟归档",
          source: "Thompson-Munson 等 / Zenodo",
          url: "https://doi.org/10.5281/zenodo.10069583",
          type: "模式输出",
          coverage: "论文的格陵兰理想化升温、降温数值实验。",
          access: "在 Zenodo 获取作者归档及版本说明。",
        },
        "比较升温与降温实验的粒雪空气含量响应。",
        "归档是模拟输出，现场验证仍依赖独立的实测剖面。",
      ),
      need(
        "粒雪过程模型",
        {
          datasetId: "slf:snowpack",
          product: "SNOWPACK · 粒雪热力与致密化模型",
          source: "WSL Institute for Snow and Avalanche Research SLF",
          url: "https://www.slf.ch/en/services-and-products/snowpack/",
          type: "模型软件",
          role: "method",
          spatial: "nonspatial",
          coverage:
            "单点垂向分层积雪和粒雪过程模型。格陵兰原文以 MERRA-2 气象量驱动。",
          access:
            "从 SLF 页面获取开源软件、模型手册及输入配置；逐站或逐格点准备气象和初始雪层。",
        },
        "分别施加升温、降温扰动，模拟渗流、再冻结、密实化与粒雪空气含量。",
        "模型需独立的初始剖面、强迫和充分自旋；使用 CARRA 替代原文驱动时需另行验证。",
      ),
    ],
  },
  Q08: {
    region: "北半球海冰与北太平洋气候模态",
    gap: "先按同年同月配对，再按统一基准期求距平、比较去趋势前后的相关，并检验自相关与滞后选择。海冰范围与 PDO 均为汇总时间序列，当前实读样本只覆盖每年 9 月。",
    needs: [
      need(
        "海冰范围",
        {
          datasetId: "nsidc:g02135-v4-north-extent",
          years: [1978, null],
          product: "NSIDC Sea Ice Index v4 · 北半球海冰范围",
          source: "NOAA / NSIDC",
          url: "https://nsidc.org/data/g02135/versions/4",
          type: "时间序列",
          spatial: "nonspatial",
          coverage:
            "1978 年起的极区卫星记录。北半球范围为浓度达到 15% 阈值的海冰网格面积之和。",
          access:
            "从北半球 monthly/data 目录按月份取 CSV，使用 extent 列，单位百万 km²。",
        },
        "以每年 9 月平均范围比较年际变化。",
        "月平均范围、单日最小范围和浓度加权面积各有不同定义。半球汇总记录没有单个网格位置。",
        [
          {
            kind: "table",
            label: "9 月平均海冰范围 · 原始月表选列",
            columns: ["月份", "范围（百万 km²）"],
            rows: september.map((r) => [r[0], r[1]]),
            url: septemberSources.extent,
          },
        ],
      ),
      need(
        "PDO 指数",
        {
          datasetId: "noaa-psl:pdo-ensemble",
          years: [1891, null],
          product: "NOAA PSL · PDO 月指数",
          source: "NOAA Physical Sciences Laboratory",
          url: "https://psl.noaa.gov/data/timeseries/month/PDO/",
          type: "时间序列",
          role: "index",
          spatial: "nonspatial",
          coverage:
            "北太平洋 SST 异常的主模态，每个月一个指数。PSL 此版组合三套 SST 并采用 1920–2014 基准期。",
          access:
            "从 PSL 下载 CSV，按 YYYY-MM 与海冰月表内连接，排除 -9999 缺测。",
        },
        "配对同年 9 月的 PDO 与海冰范围，作为年代际气候协变量。",
        "本表采用 PSL ensemble 版本（单位 °C）。原论文用 JISAO PDO，复现时须固定版本、标准化和基准期。",
        [
          {
            kind: "table",
            label: "9 月 PDO · 原始月表选列",
            columns: ["月份", "PDO（°C）"],
            rows: september.map((r) => [r[0], r[2]]),
            url: septemberSources.pdo,
          },
        ],
      ),
      need(
        "海温背景场",
        {
          datasetId: "noaa:ersstv5",
          years: [1854, null],
          product: "ERSSTv5 · 月海表温度",
          source: "NOAA NCEI",
          url: "https://www.ncei.noaa.gov/products/extended-reconstructed-sst",
          type: "栅格",
          coverage: "1854 年起的全球月平均海温重建，v5 网格为 2°。",
          access: "从产品页选择 Version 5，取月度 NetCDF；记录版本和气候基准。",
        },
        "用于核查北太平洋 SST 异常与空间模态。",
        "可与 PDO 比较，但该指数本身已使用 SST，二者不能视作完全独立验证。",
      ),
      need(
        "环流背景",
        {
          datasetId: "noaa:20crv3-prmsl", extent: "world",
          years: [1836, 2015],
          product: "20CRv3 · 月平均海平面气压",
          source: "NOAA PSL / CIRES / DOE",
          url: "https://psl.noaa.gov/thredds/ncss/grid/Datasets/20thC_ReanV3/Monthlies/miscSI-MO/prmsl.mon.mean.nc/dataset.html",
          type: "栅格",
          coverage: "全球月度历史再分析，标准时段至 2015 年。",
          access: "用 NOAA 的 NetCDF Subset Service 按经纬度和年月提取 prmsl。",
        },
        "比较海冰异常年份的环流背景。",
        "加入 20CRv3 后共同时间窗须截到 2015 年，早期观测稀疏时应检查集合不确定性。",
      ),
    ],
  },
  Q09: {
    region: "全球通量塔，各站足迹及年份不同",
    gap: "用通量塔足迹或代表性像元提取 LAI，配对 8 天窗口的有效通量与气象量，报告缺测填补与年际差异。",
    needs: [
      need(
        "通量塔记录",
        fluxnet,
        "从 LE、H 和 NEE/GPP/RECO 研究水、能量和碳交换。",
        "区分观测、填补和由通量分解估算的 GPP/RECO。LE 转 ET 前核对单位与时间积分。",
      ),
      need(
        "遥感 LAI",
        modis(
          "MOD15A2H",
          "叶面积指数 / FPAR",
          "Terra 全球植被陆地，500 m、8 天合成。",
        ),
        "取站点附近 LAI，与同一时间窗的塔数据配对。",
        "筛 QA、土地覆盖和足迹代表性，不能把单个像元等同于整座通量塔足迹。",
      ),
      need(
        "气象与土壤",
        era5land,
        "优先取 FLUXNET 同站气温、辐射和可用土壤水分，用 ERA5-Land 作为独立的陆面气象背景。",
        "按站点核实土壤探头埋深；再分析网格与探头深度、足迹及时间尺度须匹配。",
      ),
    ],
  },
  Q10: {
    region: "原文纬向带 57°S–65°N，东西方向连续",
    gap: "原文运行 2015 年 2–6 月，CP 网距 0.03°，南北边界使用 0.125°、6 小时 ECMWF 业务分析，并结合 OSTIA 海温。ERA5 是可另行设计的驱动方案。先在小域验证字段和物理配置，再估算季节模拟的 HPC 资源。",
    needs: [
      need(
        "静态地理场",
        {
          datasetId: "ncar:wps-geog",
          product: "WPS Geographical Static Data · 地形、土地覆盖与土壤",
          source: "NSF NCAR / WRF",
          url: "https://www2.mmm.ucar.edu/wrf/site/geog_data.html",
          type: "栅格",
          coverage:
            "全球多分辨率静态包，字段含地形、地类、上下层土壤质地和植被参数。",
          access:
            "下载高分辨率包或逐字段下载，解压并设置 geog_data_path，再检查 GEOGRID.TBL 中的分辨率键。",
        },
        "用 geogrid 生成目标投影和网格上的静态下垫面。",
        "Noah-MP 土地覆盖和土壤类别需与物理参数表对应。原文另用了 MODIS/CORINE 及 HWSD 土壤。",
      ),
      need(
        "气象强迫",
        pressure,
        "获取 U/V 风、气温、湿度、位势等三维场，连同单层变量形成驱动序列。",
        "ERA5 的位势与位势高度需按变量表处理。确认从地面到模式顶均有足够层次。",
      ),
      need(
        "初始和侧边界",
        {
          datasetId: "ncar:wps-wrf-initialization",
          product: "WRF WPS / real.exe · 初始与边界生成",
          source: "NSF NCAR / WRF Users Guide",
          url: wpsUrl,
          type: "方法文档",
          role: "method",
          spatial: "nonspatial",
          coverage:
            "适用于真实个例的 WPS 预处理；域、时间及边界由 namelist 指定。",
          access:
            "按官方指南运行 geogrid、ungrib、metgrid，检查 met_em 后由 WRF real.exe 生成 wrfinput / wrfbdy。",
        },
        "将静态场与逐时次气象场插值到模拟域，再构建初始和侧边界。",
        "这是生成边界文件的流程。检查 Vtable、UTC 起止与 interval_seconds、土层、周期东西边界及初始时刻。",
      ),
      need(
        "地面与陆面初始量",
        surface,
        "补足地面气压、海温、陆地掩膜、各层土温土湿等场，与大气层结联用。",
        "按陆面方案核对土层深度、单位与陆海掩膜。CDS 下载后还需执行 WPS 和 real.exe。",
      ),
      need(
        "原文模拟配置",
        {
          datasetId: "paper:10.5194/gmd-13-1959-2020",
          product: "WRF-Noah-MP v3.8.1 · 原文试验设置",
          source: "Schwitalla 等 / Geoscientific Model Development",
          url: q10Paper,
          type: "论文方法",
          role: "method",
          spatial: "nonspatial",
          coverage: "原文试验域为全经度、57°S–65°N，2015 年 2–6 月。",
          access:
            "查阅论文 §2.1 和 Supplement，并据数据可用性声明追溯原始输入。",
        },
        "复核原文的输入版本、业务分析边界和海面温度更新。",
        "原文采用 GMTED2010、HWSD 和 6 小时业务分析，默认静态包和 ERA5 仅能用于替代方案。",
        [
          {
            kind: "pdf",
            label: "论文第 3 页 · 驱动与静态场",
            url: "https://gmd.copernicus.org/articles/13/1959/2020/gmd-13-1959-2020.pdf",
            pages: [
              {
                number: 3,
                label: "§2.1 地类、土壤、6 小时边界与海表温度",
                image: "wrf-noah-mp-p3.jpg",
              },
            ],
          },
        ],
      ),
      need(
        "海洋下边界",
        {
          datasetId: "ukmo:ostia-rep-v2",
          product: "OSTIA v2.0 · 海温与海冰再处理场",
          source: "UK Met Office / NASA PO.DAAC",
          url: "https://podaac.jpl.nasa.gov/dataset/OSTIA-UKMO-L4-GLOB-REP-v2.0",
          type: "栅格",
          years: [1982, 2024],
          coverage: "全球海洋每日 0.05° 分析，归档覆盖 2015 年试验。",
          access:
            "在 PO.DAAC 选目标日期的 GHRSST L4 文件，登录 Earthdata 获取 SST、海冰与质量字段。",
        },
        "驱动下边界海面温度，明确 SST 更新频率及时间插值方式。",
        "此处为历史再处理产品。原文结合 ECMWF 业务 SST 与当时的 OSTIA，须区分输入版本。",
      ),
    ],
  },
  Q11: {
    region: "调查样本所在地区，须与影像年份一致",
    gap: "题库所列 DOI 的研究对象是波士顿与横滨照片中的表情。主观幸福感应另取问卷自评。公开问卷若只给地区编码，只能与同尺度绿地汇总量关联。",
    needs: [
      need(
        "绿地暴露",
        s2,
        "用云掩膜后的红光与近红外计算 NDVI，按授权地理单元统计绿度或绿地比例。",
        "历史调查应选同期影像；早于 Sentinel-2 的年份可换用 MODIS NDVI。居住地缓冲计算取决于地理授权。",
      ),
      need(
        "幸福感调查",
        {
          datasetId: "ess:round1-happy",
          product: "European Social Survey · 自评幸福感 happy",
          source: "European Social Survey / Sikt",
          url: "https://doi.org/10.21338/ess1e06_7",
          type: "调查表",
          spatial: "restricted",
          coverage:
            "ESS 第 1 轮（2002 年）参与国家的抽样问卷；后续轮次须另核参与国与字段。",
          access:
            "从 ESS Data Portal 登录下载，读取 happy、自变量、地区编码和抽样权重。",
        },
        "以受访者对幸福感的自评作因变量，按许可层级连接暴露。",
        "公开微观数据的地理精度须逐国核验。仅有地区编码时不能构造住址周边 300 m 缓冲。",
        [
          {
            kind: "web",
            label: "核对题库 DOI",
            url: q11Paper,
            body: "题库文件 DOI 对应 Nature and happiness in an individualist and a collectivist culture，使用照片表情指标。ESS 是回答主观幸福感问题的替代问卷。",
          },
        ],
      ),
      need(
        "协变量",
        {
          datasetId: "worldpop:population",
          product: "WorldPop · 人口分布估计",
          source: "University of Southampton / WorldPop",
          url: "https://hub.worldpop.org/",
          type: "栅格",
          coverage: "按国家、年份及数据系列提供不同分辨率的人口网格。",
          access:
            "在 WorldPop Hub 筛国家、研究年和分辨率，下载并核对是否为 constrained、是否经联合国总量校准。",
        },
        "构建调查地区的人口密度及城市化背景，与问卷年龄收入等协变量联用。",
        "固定人口年份和单位，地区人口密度不能替代个体收入或教育。",
      ),
    ],
  },
  Q12: {
    region: "东亚，原题沙尘过程为 2017 年 5 月",
    gap: "原论文使用 NCEP FNL 6 小时气象边界。采用 ERA5 或 CAM-chem 替代时单独记录试验组。将气象、化学边界、排放和观测对齐到同一 UTC 时段。",
    needs: [
      need(
        "气象边界",
        {
          datasetId: "ncar:ncep-fnl-1deg",
          product: "NCEP FNL · 全球气象分析",
          source: "NOAA NCEP / NCAR GDEX",
          url: "https://doi.org/10.5065/D6M043C6",
          type: "栅格",
          coverage: "全球 1°、6 小时大气分析，覆盖 2017 年 5 月。",
          access: "通过 NCAR GDEX 选择事件及自旋期 GRIB，按归档要求登录下载。",
        },
        "使用与论文一致的气象源驱动 WRF-Chem，也可另设 ERA5 驱动敏感性试验。",
        "气象分析不包含化学物种边界，须另配化学场，并核对 WPS Vtable。",
      ),
      need(
        "排放清单",
        {
          datasetId: "jrc:edgar-air-pollutants",
          years: [1970, 2022],
          product: "EDGAR · 人为大气污染物排放",
          source: "European Commission Joint Research Centre",
          url: "https://edgar.jrc.ec.europa.eu/dataset_ap81",
          type: "栅格",
          coverage: "EDGAR v8.1 全球人为污染物按年份和部门编目，可选 2017 年。",
          access:
            "在 JRC 选目标年份、部门与物种并下载网格；中国区域也可核对同年的 MEIC。",
        },
        "为模拟提供人为源背景，按机制分配物种并转换网格和时间分布。",
        "人为排放与风蚀起沙的源项不同，年度总量需做单位及小时分配。",
      ),
      need(
        "起沙参数",
        {
          datasetId: "paper:10.5194/gmd-13-2125-2020",
          product: "WRF-Chem v3.9 · 起沙与干沉降试验",
          source: "原论文 / Geoscientific Model Development",
          url: "https://gmd.copernicus.org/articles/13/2125/2020/",
          type: "论文方法",
          role: "method",
          spatial: "nonspatial",
          coverage: "论文给出 2017 年 5 月东亚个例的起沙与干沉降组合。",
          access:
            "查方法、附录及 Supplement，按代码版本核对源区分布、参数表和运行开关。",
        },
        "固定气象与其他排放输入，一次比较一个方案因素。",
        "参数化方案是算法，仍需土壤、可蚀性和实际风场作为输入。",
      ),
      need(
        "观测验证",
        {
          datasetId: "nasa:aeronet-v3-aod",
          product: "AERONET V3 · 气溶胶光学厚度",
          source: "NASA AERONET",
          url: "https://aeronet.gsfc.nasa.gov/cgi-bin/webtool_aod_v3",
          type: "站点",
          coverage: "全球太阳光度计站；晴空白天观测，事件期间各站有效性不同。",
          access:
            "选择站点、日期、波段和 Level 2.0 下载，核对原文站点及有效样本。",
        },
        "比较沙尘经过时柱积分 AOD 与模拟同波长 AOD。",
        "AOD 与地表 PM₁₀ 单位和垂直含义不同，地面浓度检验还需独立站点监测。",
      ),
      need(
        "化学初始和边界",
        {
          datasetId: "ncar:cam-chem-boundary",
          product: "CESM2.1 CAM-chem · 化学边界场",
          source: "NSF NCAR",
          url: "https://doi.org/10.5065/NMP7-EP60",
          type: "模式输出",
          coverage: "全球 CAM-chem 输出的历史时段含 2017 年 5 月。",
          access:
            "由 NCAR 归档注册下载或截取，使用物种映射与垂直插值工具生成化学边界。",
        },
        "为区域化学模拟补齐域外输送与初始化。",
        "逐一核对目标机制的物种和气溶胶粒径箱，以及端点时次和单位。",
      ),
    ],
  },
  Q13: {
    region: "北极夏季海冰区",
    gap: "配对相同日期与足迹内的亮温、融池分数和开阔水比例。独立光学验证要剔云，并将细像元聚合到微波足迹。",
    needs: [
      need(
        "微波亮温",
        {
          datasetId: "nsidc:ae_si12-v4",
          years: [2002, 2011],
          product: "AMSR-E / Aqua · 极区微波亮温",
          source: "NASA NSIDC DAAC",
          url: "https://nsidc.org/data/ae_si12/versions/4",
          type: "栅格",
          coverage:
            "AMSR-E 任务约 2002–2011 年，极区日网格 12.5 km，多频率和极化。",
          access:
            "在 NSIDC 按原论文年份和北极区域筛选，登录 Earthdata 获取对应文件。",
        },
        "以原研究时期可用的 AMSR-E 为亮温输入，比较融池增加时的响应。",
        "AMSR2 的任务期更晚，复现旧个例须检查重叠。标称网格间距并非各频率的真实足迹。",
      ),
      need(
        "融池识别影像",
        {
          datasetId: "nasa:myd02hkm",
          product: "MODIS / Aqua MYD02HKM · 可见光与近红外条带",
          source: "NASA LAADS DAAC",
          url: "https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/MYD02HKM",
          type: "影像",
          coverage:
            "Aqua 过境的 5 分钟条带、500 m 波段，按研究日期筛北极日照场景。",
          access:
            "通过 LAADS DAAC 登录获取匹配的 L1B、地理定位和云掩膜文件，固定处理版本。",
        },
        "对光学波段定标与大气校正后分离融池、裸冰与开阔水，并聚合到微波足迹。",
        "暗像元可能是融池或开阔水，也可能受阴影影响。多波段分类需独立验证，光学云遮区域留空。",
      ),
      need(
        "海冰密集度",
        {
          datasetId: "nsidc:0079-v4",
          product: "Bootstrap Sea Ice Concentrations v4",
          source: "NASA NSIDC DAAC",
          url: "https://nsidc.org/data/nsidc-0079/versions/4",
          type: "栅格",
          coverage: "南北极海冰被动微波历史网格，25 km。",
          access: "在 NSIDC 选北极日期，获取原始浓度和标志值。",
        },
        "将 Bootstrap 密集度与同足迹光学估计比较。",
        "夏季融池和湿雪会改变辐射特性。比较算法时控制传感器、尺度和日期。",
      ),
      need(
        "对照算法",
        {
          datasetId: "nsidc:0051",
          product: "NASA Team · 被动微波海冰密集度",
          source: "NASA NSIDC DAAC",
          url: "https://nsidc.org/data/nsidc-0051",
          type: "栅格",
          coverage: "南北极历史海冰浓度网格，25 km。",
          access: "在 NSIDC 选择覆盖论文时段的版本并下载日场。",
        },
        "在共同有效像元对比 NASA Team 和 Bootstrap 的残差。",
        "两种算法可能使用同系列传感器，算法间差异不能替代独立光学观测。",
      ),
    ],
  },
  Q15: {
    region: "欧洲人群队列，原文涵盖瑞典与荷兰",
    gap: "原文按基线与随访地址赋值，早期队列可追溯至 1990 年代。若有完整日期，可再按居住天数加权。2022 轮噪声图以 2021 为参考年，与后期卫星产品均只能支持相应年份或注明假设的代理分析。",
    needs: [
      need(
        "污染物",
        {
          datasetId: "eea:pm25-interpolated",
          product: "EEA · PM₂.₅ 年均浓度图",
          source: "European Environment Agency",
          url: "https://www.eea.europa.eu/en/datahub/datahubitem-view/938bea70-07fc-47e9-8559-8a09f7f92494",
          type: "栅格",
          coverage:
            "欧洲年度地面浓度插值图。该目录列有 2007–2008 及 2010 年起的多个年份，版本随年份变化。",
          access:
            "从 EEA Datahub 选择目标年、正式或临时版本，下载 GeoTIFF 与说明。",
        },
        "在旧址、新址各自的居住年份提取 PM₂.₅ 年平均（µg/m³）。",
        "格点值为室外背景浓度估计，分辨率不足时难以捕捉街道梯度，缺年须显式标记。",
      ),
      need(
        "绿地",
        s2,
        "在一致季节对有效观测合成 NDVI，以相同半径缓冲区计算新旧住址周边的平均绿度。",
        "历史年份早于覆盖时可改选同期 MODIS。云量、物候和缓冲半径会影响前后差值。",
      ),
      need(
        "噪声",
        {
          datasetId: "eea:end-2022-contours",
          years: [2021, 2021],
          product: "EEA END 2022 · 战略噪声等值区",
          source: "European Environment Agency",
          url: "https://sdi.eea.europa.eu/catalogue/eea-statistical-data/api/records/853e72e4-4642-47d1-8556-2cc231bd43e0?language=eng",
          type: "矢量",
          coverage:
            "2022 制图轮次，参考年为 2021（1 月 1 日至 12 月 31 日）。覆盖已上报的欧洲城市集聚区、主要公路、铁路与机场。",
          access:
            "按国别取 GeoPackage，选择噪声源、Lden（日晚夜）或 Lnight（夜间）及分贝区间。",
        },
        "空间叠加住址，取得对应噪声源和指标的 dB 区间。",
        "区外或未上报记为未知。仅有 2022 轮次不能代表所有搬迁年份，跨轮次还需核对制图方法。",
      ),
      need(
        "队列地址历史",
        {
          datasetId: "cohort:sdpp-amigo-bamse-piama-access",
          product: "SDPP / AMIGO / BAMSE / PIAMA · 地址历史申请",
          source: "原论文研究团队与各队列数据保管方",
          url: q15Paper,
          type: "申请线索",
          role: "request",
          spatial: "restricted",
          coverage:
            "原论文涉及瑞典、荷兰的成人及出生队列；个人住址与居住起止日期的可用性依协议。",
          access:
            "通过论文通讯作者或各队列办公室申请。说明研究目的、所需地址精度和日期，确认伦理、数据协议和可输出的汇总尺度。",
        },
        "在获批环境内把住址起止时间与年度暴露层关联，每人比较搬迁前后。",
        "此处提供研究机构入口与公开队列说明。结果应依队列许可汇总，个体地址和轨迹不在公共地图上显示。",
        [
          {
            kind: "pdf",
            label: "原论文表 1 · 队列与地址来源",
            version: "HAL v1",
            url: "https://hal.science/hal-04769423v1/file/Saucy_2023.pdf",
            pages: [
              {
                number: 4,
                label:
                  "Saucy 等（2023），论文第 3 页，HAL PDF 第 4 页。表 1 列出四个队列的时期与地址历史来源；§2.3 说明了暴露赋值。",
                image: "europe-relocation-hal-p4.jpg",
                box: [0.058, 0.076, 0.881, 0.2],
              },
            ],
          },
          {
            kind: "web",
            label: "瑞典 BAMSE 项目联系入口",
            url: "https://ki.se/imm/forskning-vid-imm/enheter-vid-imm/enheten-for-miljomedicinsk-epidemiologi/bamse-projektet",
            body: "Karolinska Institutet 公布 BAMSE 项目秘书处和负责人联系方式，可核实合作及审批流程。",
          },
          {
            kind: "web",
            label: "荷兰 AMIGO 项目联系入口",
            url: "https://amigoproject.nl/vraag-en-antwoord/",
            body: "Utrecht University / Nivel 公布研究团队联系方式，可询问可用居住史字段及获批环境内的暴露赋值。",
          },
        ],
      ),
      need(
        "交通相关空气污染",
        {
          datasetId: "eea:no2-interpolated",
          product: "EEA · NO₂ 年均浓度图",
          source: "European Environment Agency",
          url: "https://www.eea.europa.eu/en/datahub/datahubitem-view/34bd02bf-be87-4122-b9a2-1e846c27a786",
          type: "栅格",
          coverage:
            "欧洲多年份 NO₂ 地面年均浓度插值网格，可用年份按发布版本核对。",
          access: "从 EEA 目录取相应年度栅格及元数据，与 PM₂.₅ 统一坐标系。",
        },
        "补充与交通活动相关的 NO₂ 暴露。",
        "同一住址的区域年均值可能低估路旁梯度，核实像元大小与住宅位置精度。",
      ),
      need(
        "早期绿度对照",
        ndvi,
        "对早于 Sentinel-2 的居住年份，可使用同期 MODIS 生长季 NDVI。",
        "空间分辨率为 250 m，狭小绿地或街区可能混入其他地物，2000 年以前仍需其他影像。",
      ),
    ],
  },
  Q16: {
    region: "原文马拉维及研究流域，水文边界可能跨国",
    gap: "先确定汇流边界，再核对上下游控制站、抽水井、水库运行及灌溉时段。全国总量仅适合约束汇总结果，不能直接当作逐网格实测用水。",
    needs: [
      need(
        "气象驱动",
        era5land,
        "提取降水、温度、风和辐射，按水文模型需要汇总到日尺度。",
        "将累计量正确拆分并转换单位，特别核对山区降水偏差及当地雨量站。",
      ),
      need(
        "径流校验",
        {
          datasetId: "grdc:discharge",
          product: "GRDC · 河流流量站记录",
          source: "Global Runoff Data Centre",
          url: "https://grdc.bafg.de/data/data_portal/",
          type: "站点",
          coverage:
            "全球参加交换的河流站，流域、站年及变量须在目录中逐站核对。",
          access: "从 GRDC 门户按流域或站号提交资料请求，接受使用和共享条款。",
        },
        "用控制站流量校准水量平衡，并留出年份或站点作验证。",
        "核对集水面积、单位、缺测和上游水库调度，未提取本流域实测序列。",
      ),
      need(
        "当地用水",
        {
          datasetId: "malawi:local-water-use-request",
          product: "马拉维用水、灌溉与水库运行 · 地方资料线索",
          source: "Hinton 等 / 研究团队与地方水务部门",
          url: "https://doi.org/10.1016/j.ejrh.2025.102574",
          type: "申请线索",
          role: "request",
          spatial: "restricted",
          coverage:
            "论文以马拉维为例，通过利益相关方半结构访谈补足地方管理信息。",
          access:
            "按论文识别地方水资源、灌溉及水库管理方，申请统计和运行记录，确认访谈使用许可。",
        },
        "获取取水、灌溉安排、回归水及水库运行规则。",
        "访谈、许可量、设计需水量与实际抽取量应分别记录，调查原始表及井位须另行取得。",
      ),
      need(
        "地下水",
        {
          datasetId: "usgs:modflow6",
          product: "MODFLOW 6 · 地下水模拟器",
          source: "USGS",
          url: "https://www.usgs.gov/software/modflow-6-usgs-modular-hydrologic-model",
          type: "模型软件",
          role: "method",
          spatial: "nonspatial",
          coverage: "通用地下水模拟软件，可按研究区自建计算域与网格。",
          access:
            "下载 USGS 发行版和说明，另配含水层几何、导水率、补给边界、抽水及井水位。",
        },
        "在有水文地质输入时与地表水模型耦合，模拟地下水响应。",
        "软件不提供本流域井水位和抽取记录；含水层参数及校准观测仍待取得。",
      ),
      need(
        "地表水与用水模拟",
        {
          datasetId: "iiasa:cwatm",
          product: "CWatM · 地表水与人类用水模拟",
          source: "IIASA / Community Water Model",
          url: "https://cwatm.iiasa.ac.at/12_faq.html",
          type: "模型软件",
          role: "method",
          spatial: "nonspatial",
          coverage: "可按全球、国家或流域设置计算域，并可耦合 MODFLOW。",
          access:
            "由 CWatM 官方文档取得软件、设置样例和数据要求，记录版本及试验的网格设置。",
        },
        "组织气象、水文、土地利用及用水输入，检验有无地方信息的模型差别。",
        "须另备运行配置和观测，网格分辨率由具体试验决定。",
      ),
      need(
        "蒸散交叉校验",
        modis("MOD16A2GF", "实际与潜在蒸散", "全球植被陆地，500 m、8 天累计。"),
        "按流域聚合实际 ET，辅助检查模型的水量分配。",
        "遥感估算也有误差，筛质量位、植被掩膜并转换累计时段。",
      ),
      need(
        "土壤水分交叉校验",
        {
          datasetId: "esa:cci-sm-combined-v9.2",
          product: "ESA CCI · 表层土壤水分 v09.2",
          source: "ESA Climate Change Initiative",
          url: "https://climate.esa.int/en/catalogue/d4e66299f5054129b8076fb7502949e1/",
          type: "栅格",
          years: [1978, 2024],
          coverage:
            "1978–2024 年全球日尺度 0.25° 表层土壤水分，混合主动与被动微波估计。",
          access: "按 ESA CCI 目录下载 COMBINED NetCDF 及质量说明，截取流域。",
        },
        "用季节变化与模型表层土壤水分作独立产品对照。",
        "表层对照不能验证深层地下水储量；植被稠密等区域须检查质量与有效覆盖。",
      ),
    ],
  },
  Q17: {
    region: "南非 Agincourt 人口健康监测区",
    gap: "先获批家庭粮食安全和生计指标，按调查年份、回顾窗口及获批地区汇总降水和植被，留出独立家庭或波次验证 BBN。",
    needs: [
      need(
        "家庭随访",
        {
          datasetId: "agincourt:hdss-food-security",
          product: "Agincourt HDSS · 家庭粮食安全与生计随访",
          source: "MRC / Wits Agincourt Unit",
          url: "https://www.agincourt.co.za/data-lavels",
          type: "申请线索",
          role: "request",
          spatial: "restricted",
          coverage:
            "南非 Agincourt 监测区的家庭与个人调查；食物安全模块随访年份和地址精度需申请确认。",
          access:
            "查看公开问卷和数据层级，向 Agincourt Unit 递交项目方案，按核准的研究字段和地理尺度连接。",
        },
        "构建家庭食物不足、收入、生计和人口组成节点。",
        "论文使用的家庭分析表受许可限制。公开样本与汇总指标须核验是否含所需模块。",
        [
          {
            kind: "web",
            label: "调查量表",
            url: "https://www.agincourt.co.za/1808-2-2",
            body: "在 Data Instruments 查 Food Security Status Form，核实具体题项和回顾期。",
          },
        ],
      ),
      need(
        "降水",
        chirps,
        "按调查前的种植季或旱季累计降水，并构造同季气候距平。",
        "授权只到村时须在村尺度汇总；保留雨季跨公历年的实际时间窗。",
      ),
      need(
        "植被指数",
        ndvi,
        "计算村域或许可缓冲区内生长季 NDVI，作为植被生产状况代理。",
        "遥感绿度不能直接测量粮食获取，缺测与滞后窗口需做敏感性检查。",
      ),
      need(
        "贝叶斯网络方法",
        {
          datasetId: "paper:10.1186/s12889-021-10938-y",
          product: "Agincourt · 家庭粮食安全 BBN 建模方法",
          source: "原论文 / BMC Public Health",
          url: "https://doi.org/10.1186/s12889-021-10938-y",
          type: "论文方法",
          role: "method",
          spatial: "nonspatial",
          coverage: "原论文针对南非农村样本构建多种候选网络。",
          access:
            "从论文核对变量、离散化和网络结构；用 GeNIe 等 BBN 工具估计条件概率及敏感性。",
        },
        "比较节点方向与条件分布假设，评估未见样本。",
        "网络结构和先验知识需单独说明。仅有空间相关关系不能验证因果方向。",
      ),
    ],
  },
  Q18: {
    region: "中国内蒙古草原",
    gap: "统一草地掩膜和质量规则，用多种拟合及阈值对比返青日期，以有记录的地面观测独立验证。稀疏草地、积雪和长缺口会显著改变拟合。",
    needs: [
      need(
        "NDVI 时序",
        ndvi,
        "提取生长季两端足够长的 NDVI 序列，保留合成观测日。",
        "采用精确观测日期、缩放系数与缺值规则；16 天合成的采样间隔限制返青日精度。",
      ),
      need(
        "质量掩膜",
        {
          datasetId: "nasa:mod13q1.061-qa-guide",
          product: "MOD13Q1 · VI Quality 与 Pixel Reliability 说明",
          source: "NASA LP DAAC",
          url: ndvi.url,
          type: "质量说明",
          role: "method",
          spatial: "nonspatial",
          coverage:
            "随 MOD13Q1 每个合成期、每个像元提供的 QA 字段；本文档解释其用途。",
          access:
            "从 MOD13Q1 产品文档核对 DetailedQA / VI Quality 与像元可靠度位，随 NDVI 下载质量层。",
        },
        "为云、雪、低可信观测和缺值建立掩膜。",
        "位掩码须按所用产品版本解码。长缺口应留空或降低权重，并记录每季有效样本。",
      ),
      need(
        "返青日期验证",
        modis(
          "MCD12Q2",
          "年度陆面物候",
          "全球陆地，500 m 年度物候指标，包含 Greenup 和质量层。",
        ),
        "作为另一套物候算法的产品级对照，统一年份和物候定义后比较。",
        "同属 MODIS，传感器误差相关。独立地面验证仍需申请或查找当地草地样方物候记录。",
      ),
      need(
        "返青日期提取",
        {
          datasetId: "lund:timesat",
          product: "TIMESAT · 物候曲线拟合与季节起点",
          source: "Lund University / TIMESAT",
          url: "https://web.nateko.lu.se/timesat/timesat.asp",
          type: "方法文档",
          role: "derived",
          spatial: "nonspatial",
          coverage: "时间序列拟合软件，需用户提供 NDVI 及其权重。",
          access:
            "按官网许可获取软件，用质量筛选后的序列拟合双逻辑曲线或 Savitzky–Golay 平滑，再按幅度阈值提取上升期。",
        },
        "在同一像元上比较不同平滑参数和相对阈值，输出返青日及敏感性范围。",
        "最大 NDVI 日期对应峰值；返青日取上升段跨越阈值的日期，阈值需针对草地类型校准。异常低幅度、雪后突跳或双季像元应标旗。",
      ),
    ],
  },
};
