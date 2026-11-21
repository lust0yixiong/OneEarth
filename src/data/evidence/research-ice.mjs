const copdem = 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM';
const awsDem = 'https://registry.opendata.aws/copernicus-dem/';
const era5Land = 'https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land?tab=overview';
const rgi = 'https://doi.org/10.7265/4M1F-GD79';
const cog = tile => `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_${tile}_DEM/Copernicus_DSM_COG_10_${tile}_DEM.tif`;
const table = (label, columns, rows) => ({kind:'table',label,columns,rows});
const web = (label, body) => ({kind:'web',label,body});

// Values below were read from the native-resolution Float32 band, without interpolation.
// Coordinates are the actual pixel centres; each was checked against its RGI 6 outline.
export const demSamples = [
  {name:'Hintereisferner',center:[10.751666666666667,46.80222222222223],value:3234.754638671875,url:cog('N46_00_E010_00')},
  {name:'Columbia Glacier',center:[-146.88777777777776,61.29888888888889],value:938.6640625,url:cog('N61_00_W147_00')}
];

export const iceCase = {
  title:'冰川物质平衡的数据从哪里获取',
  question:'想用遥感方法估算冰川物质平衡，需要高分辨率DEM、冰川边界和逐时气象数据，分别从哪里获取？',
  region:'原题未限定研究区；Hintereisferner 与 Columbia Glacier 用于入口验证',
  needs:[
    {
      name:'高分辨率 DEM',type:'高程栅格',product:'Copernicus DEM GLO-30 · 公开云 COG',
      status:'单期像元已实读',
      detail:'已从公开 COG 分别读取 Hintereisferner 和 Columbia Glacier 边界内的原分辨率高程像元。GLO-30 是30米级地表高程；单份跨年合成产品不构成多期 DEM。原题尚未给出分辨率阈值。若选用高程差分法，还需第二期高程及其实际采集时间。',
      dataEntities:demSamples.map(s=>({label:s.name+' · COG 瓦片',url:s.url,format:'GeoTIFF'})),
      url:copdem,source:'Copernicus Data Space · Sinergise/AWS 公开 COG 与瓦片元数据',
      tabs:[
        table('真实像元实读',['冰川','像元中心经度 °','像元中心纬度 °','正高（米）','原始行 / 列（从0计）'],[
          ['Hintereisferner',10.751666666666667,46.80222222222223,3234.754638671875,'712 / 2706'],
          ['Columbia Glacier',-146.88777777777776,61.29888888888889,938.6640625,'2524 / 202']
        ]),
        table('产品与时间核验',['核验项','已核事实'],[
          ['公开云版本','AWS 目录说明该 COG 来源于 Copernicus DEM 2021 release；不能将其标为最新 CDSE 版本。'],
          ['Hintereisferner 瓦片','N46E010；XML 源数据时间范围为2011-05-17至2014-08-17。'],
          ['Columbia Glacier 瓦片','真实边界跨 N61W147 与 N61W148；两份 XML 源数据时间范围均为2011-01-20至2014-09-12。'],
          ['时间证据范围','上述日期是瓦片源数据时间范围；STAC datetime 为 null，尚未确定取样像元的单一采集日期。'],
          ['单位与基准','STAC 标明正高、单位米；Copernicus DEM 垂向基准为 EGM2008。'],
          ['网格','N46E010 为3600×3600；N61W147为3600×1800。纬向1角秒，阿拉斯加所在纬带经向2角秒。'],
          ['精度限制','30米级网格间距不等于垂向精度。官方误差统计可有局地偏离；尚未验证取样位置的误差层、填补来源或雷达对雪冰的影响。'],
          ['多期条件','产品发布或维护年份不能当观测年份。需另取一个有效量测时点，并核对配准、垂向基准和雪季差异。']
        ]),
        web('原始入口与验证范围',`公开 COG 入口：${awsDem}。Hintereisferner STAC：https://copernicus-dem-30m-stac.s3.amazonaws.com/items/Copernicus_DSM_COG_10_N46_00_E010_00.json。Columbia STAC：https://copernicus-dem-30m-stac.s3.amazonaws.com/items/Copernicus_DSM_COG_10_N61_00_W147_00.json 与 https://copernicus-dem-30m-stac.s3.amazonaws.com/items/Copernicus_DSM_COG_10_N61_00_W148_00.json。目录核验、瓦片存在和单像元实读分别记录；取样不能证明整条冰川均无缺测，也不能代表整条冰川平均高程。`)
      ]
    },
    {
      name:'逐时气象',type:'再分析格点与时间序列',product:'ERA5-Land hourly',
      status:'官方目录已核实；尚未实读',
      detail:'Copernicus CDS 提供1950年至今的逐小时陆地再分析，可选气温、露点、风、降水、辐射等。发布网格0.1°，原生约9公里；本次尚未下载两个样区的气象记录。',
      url:era5Land,source:'Copernicus C3S Climate Data Store · ECMWF 技术文档',
      tabs:[
        table('已核产品信息',['项目','官方说明'],[
          ['时间','1950年至今；逐小时；日更新。近期数据可能为 ERA5-Land-T 初步版本。'],
          ['空间','全球陆地；海洋被掩膜。CDS 发布网格0.1°×0.1°，原生约9公里。'],
          ['变量','2米气温与露点、10米风分量、地表气压、降水、降雪和辐射等，按需要选择。'],
          ['获取','CDS 网页或 API；需账号、接受数据集条款；API 需个人令牌。'],
          ['许可','当前 CDS 页面列为 CC-BY；引用 DOI：10.24381/cds.e2161bac。'],
          ['实际验证','已核对产品目录与访问条件；未核对两个样区在指定研究期的逐时记录、缺测与偏差。'],
          ['使用限制','原始降水、辐射等累积字段需按 UTC 累积规则转换为小时增量；9公里格点不能直接视为冰川尺度现场观测。']
        ]),
        web('使用前的变量核对','技术依据：https://confluence.ecmwf.int/spaces/CKB/pages/140385202/ERA5-Land+data+documentation。原始产品累积量从00 UTC累计；00 UTC值对应前24小时。需核对单位、时间边界、地形高度差与偏差校正。ERA5-Land 的部分气象强迫场仅插值到更细网格；冰川格点的标准雪深值不能作为实际冰厚或物质平衡。API说明：https://cds.climate.copernicus.eu/how-to-api。')
      ]
    },
    {
      name:'冰川边界',type:'矢量轮廓',product:'Randolph Glacier Inventory 6.0',
      status:'两条真实轮廓已读',
      detail:'已读取 OGGM 保存的两条 RGI 6.0 样本轮廓与属性，并用于判断 DEM 取样位置是否在边界内。边界代表其编目时段；与 DEM 日期、研究时段的对应关系仍需核对。',
      url:rgi,source:'RGI 6.0 · OGGM/oggm-sample-data 中的原始 Shapefile 样本',
      tabs:[
        table('实际轮廓属性',['冰川','RGI 标识','编目起始 / 结束日期字段','面积 km²','目录标注中心（经度，纬度）'],[
          ['Hintereisferner','RGI60-11.00897','20030799 / 20030999（99为未知日）',8.036,'10.7584, 46.8003'],
          ['Columbia Glacier','RGI60-01.10689','20090906 / -9999999（结束日缺失）',773.873,'-146.888, 61.299']
        ]),
        web('原始轮廓与证据范围','RGI 6.0 数据入口：https://doi.org/10.7265/4M1F-GD79。本次实读轮廓来自 https://github.com/OGGM/oggm-sample-data/blob/master/test-files/Hintereisferner_RGI6.shp 与 https://github.com/OGGM/oggm-sample-data/blob/master/test-files/columbia_rgi/RGI60-01.10689.shp，连同对应的 SHX、DBF 和 PRJ 文件读取。样本轮廓用于验证入口与取样位置，不表示已获取研究期内的逐年边界。')
      ]
    }
  ],
  spatial:'ice',
  gap:'原题尚未给出研究区、研究时段和分辨率阈值。目前核实了数据入口与两条历史轮廓，并在两处各读到一个单期 DEM 像元；研究期逐时气象与三类数据的时空匹配仍待核验。若采用高程差分法，还需第二期有效 DEM。'
};
