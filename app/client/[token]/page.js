'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { formatCurrency, formatNum, formatMonth, aggregateRows, aggregateCrmRows, aggregateCrmReportRows, changePercent, getPrevMonth, COLORS } from '../../../lib/helpers'
import Chart from 'chart.js/auto'

export default function ClientPage() {
  const params = useParams()
  const token = params.token

  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState(null)
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [reports, setReports] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [error, setError] = useState(false)
  const [dashTab, setDashTab] = useState('all')
  const [crmSubTab, setCrmSubTab] = useState('sources')
  const [sortConfig, setSortConfig] = useState({})
  const chartsRef = useRef([])

  const handleSort = (tableId, key) => { setSortConfig(prev => { const cur = prev[tableId]; if (cur && cur.key === key) return {...prev, [tableId]: {key, dir: cur.dir === 'desc' ? 'asc' : 'desc'}}; return {...prev, [tableId]: {key, dir: 'desc'}}; }); }

  useEffect(() => {
    async function load() {
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('token', token)
        .single()

      if (clientError || !clientData) {
        setError(true)
        setLoading(false)
        return
      }

      setClient(clientData)

      const { data: projectsData } = await supabase
        .from('projects')
        .select('*')
        .eq('client_id', clientData.id)
        .order('created_at')

      if (projectsData && projectsData.length > 0) {
        setProjects(projectsData)
        setSelectedProject(projectsData[0])
        await loadReports(projectsData[0].id)
      }

      setLoading(false)
    }
    load()
  }, [token])

  const loadReports = async (projectId) => {
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('project_id', projectId)
      .order('month', { ascending: false })

    if (data) {
      setReports(data)
      if (data.length > 0) setSelectedMonth(data[0].month)
    } else {
      setReports([])
    }
  }

  const switchProject = async (proj) => {
    setSelectedProject(proj)
    setCompareEnabled(false)
    setDashTab('all')
    setCrmSubTab('sources')
    await loadReports(proj.id)
  }

  const destroyCharts = () => {
    chartsRef.current.forEach(c => c.destroy())
    chartsRef.current = []
  }

  const createChart = (id, type, labels, datasets, scalesConfig) => {
    const canvas = document.getElementById(id)
    if (!canvas) return
    const config = {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Heebo' } } } }
      }
    }
    if (type !== 'doughnut' && type !== 'pie') {
      config.options.scales = scalesConfig || { y: { beginAtZero: true, position: 'right' } }
    }
    const chart = new Chart(canvas, config)
    chartsRef.current.push(chart)
  }

  // ==================== CRM REPORTS SUB-TAB ====================
  const renderCrmReportDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null
    destroyCharts()

    const crmRepReports = reports.filter(r => r.month === selectedMonth && r.source === 'crm_reports')
    if (crmRepReports.length === 0) return <div className="welcome-center"><div className="icon">ð­</div><h3>××× × ×ª×× × CRM ×××××ª ×××××© ××</h3></div>

    let allRows = []
    crmRepReports.forEach(r => { if (r.data) allRows = allRows.concat(r.data) })
    const repData = aggregateCrmReportRows(allRows)
    const rt = repData.totals

    const cityEntries = Object.entries(repData.cities).sort((a, b) => b[1] - a[1])
    const objEntries = Object.entries(repData.objectionTypes).sort((a, b) => b[1] - a[1])
    const cityNames = cityEntries.map(([n]) => n)
    const objNames = objEntries.map(([n]) => n)

    setTimeout(() => {
      destroyCharts()
      if (cityNames.length > 0) {
        createChart('crmRepCityChart', 'bar', cityNames, [{
          label: '×××××', data: cityNames.map(n => repData.cities[n]),
          backgroundColor: COLORS.slice(0, cityNames.length)
        }], { y: { beginAtZero: true, position: 'right' } })
      }
      if (objNames.length > 0) {
        createChart('crmRepObjChart', 'doughnut', objNames, [{
          data: objNames.map(n => repData.objectionTypes[n]),
          backgroundColor: COLORS.slice(0, objNames.length)
        }])
      }
    }, 200)

    return (
      <>
        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(59,130,246,0.1)',color:'var(--accent)'}}>ð</div><div className="kpi-label">×¡×"× ×©××¨××ª</div><div className="kpi-value">{formatNum(rt.totalRows)}</div></div>
          <div className="kpi-card green"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(16,185,129,0.1)',color:'var(-success)'}}>ðï¸ï¸</div><div className="kpi-label" >×¢×¨×× ××××××××ª</div><div className="kpi-value">{formatNum(rt.uniqueCities)}</div></div>
          <div className="kpi-card purple"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(139,92,246,0.1)',color:'var(-prgð'}}>â ï¸</div><div className="kpi-label">×¢× ××ª× ××××××ª</div><div className="kpi-value">{formatNum(rt.withObjections)}</div></div>
          <div className="kpi-card orange"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(245,158,11,0.1)',color:'var(--warning)'}}>ð</div><div className="kpi-label">×¢× ×¤×××©×/××©×××</div><div className="kpi-value">{formatNum(rt.withMeeting)}</div></div>
          <div className="kpi-card pink"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(236,72,153,0.1)',color:'var(--pink)'}}>ð</div><div className="kpi-label">% ××ª× ××××××ª</div><div className="kpi-value">{rt.objectionRate.toFixed(1)}%</div></div>
          <div className="kpi-card cyan"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(6,182,212,0.1)',color:'v"Ö7âw×Óï	ù8£ÂöFcãÆFb6Æ74æÖSÒ&·ÖÆ&VÂ#âR
zMy-yzy]z£ÂöFcãÆFb6Æ74æÖSÒ&·×fÇVR#ç·'BæÖVWFæu&FRçFôfVBÒSÂöFcãÂöFcà¢ÂöFcà ¢ÆFb6Æ74æÖSÒ'6V7Föâ#à¢ÆFb6Æ74æÖSÒ'6V7Föâ×FFÆR#ãÆFb6Æ74æÖSÒ'6V7FöâÖ6öâ"7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓw×Óï	ù8³ÂöFcíz
z­y]z
yyÒ
yízMy]zyyyÓÂöFcà¢ÆFb6Æ74æÖSÒ'F&ÆR×w&W"#à¢ÇF&ÆR6Æ74æÖSÒ&FF×F&ÆR#à¢ÇFVCãÇG#à¢ÇFâ3Â÷Fà¢ÇFíy½z­y]yz¢ýyyzy]yÂ÷Fà¢ÇFíyMz­z
y-y=y]yy]z£Â÷Fà¢ÇFíyízyyíyBýzMy-yzyB
y
y}zy]z
yCÂ÷Fà¢Â÷G#ãÂ÷FVCà¢ÇF&öGà¢¶ÆÅ&÷w2æÖ&÷rÂÓâ¢ÇG"¶W×¶Óà¢ÇFCç¶²ÓÂ÷FCà¢ÇFB7GÆS×·¶föçEvVvC£c×Óç·&÷ræFG&W72ÇÂrÒwÓÂ÷FCà¢ÇFCç·&÷ræö&¦V7Föç2ÇÂrÒwÓÂ÷FCà¢ÇFCç·&÷ræÆ7DÖVWFærÇÂrÒwÓÂ÷FCà¢Â÷G#à¢Ð¢Â÷F&öGà¢Â÷F&ÆSà¢ÂöFcà¢ÂöFcà ¢ÆFb6Æ74æÖSÒ'6V7Föâ#à¢ÆFb6Æ74æÖSÒ'6V7Föâ×FFÆR#ãÆFb6Æ74æÖSÒ'6V7FöâÖ6öâ"7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓ"w×Óï	ù8ÂöFcíy-zzMyyÓÂöFcà¢ÆFb6Æ74æÖSÒ&6'BÖw&B#à¢ÆFb6Æ74æÖSÒ&6'BÖ6&B#ãÆCï	øùûò
yMz­zMyÍy-y]z¢
yÍzMy
yyzy]yÂöCãÆFb6Æ74æÖSÒ&6'BÖ6öçFæW"#ãÆ6çf2CÒ&7&Õ&W6G6'B#ãÂö6çf3ãÂöFcãÂöFcà¢ÆFb6Æ74æÖSÒ&6'BÖ6&B#ãÆCî)ªûò
yMz­zMyÍy-y]z¢
yMz­z
y-y=y]yy]z£ÂöCãÆFb6Æ74æÖSÒ&6'BÖ6öçFæW"#ãÆ6çf2CÒ&7&Õ&Wö&¤6'B#ãÂö6çf3ãÂöFcãÂöFcà¢ÂöFcà¢ÂöFcà¢Âóà¢¢ÒÂ·6VÆV7FVDÖöçFÂ&W÷'G5Ò ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒ5$Ò4õU$4U25T"ÕD"ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¢6öç7B&VæFW$7&ÔF6&ö&BÒW6T6ÆÆ&6²Óâ°¢b6VÆV7FVDÖöçFÇÂ&W÷'G2æÆVæwFÓÓÒ&WGW&âçVÆÀ¢FW7G&÷6'G2 ¢6öç7B7&Õ&W÷'G2Ò&W÷'G2æfÇFW""Óâ"æÖöçFÓÓÒ6VÆV7FVDÖöçFbb"ç6÷W&6RÓÓÒv7&Òr¢b7&Õ&W÷'G2æÆVæwFÓÓÒ&WGW&âÆFb6Æ74æÖSÒ'vVÆ6öÖRÖ6VçFW"#ãÆFb6Æ74æÖSÒ&6öâ#ï	ù*ÓÂöFcãÆ3íy
yyò
z
z­y]z
y5$Ò
yÍy}y]y=z
ymyCÂö3ãÂöFcà ¢ÆWBÆÄ7&Õ&÷w2ÒµÐ¢7&Õ&W÷'G2æf÷$V6"Óâ²b"æFFÆÄ7&Õ&÷w2ÒÆÄ7&Õ&÷w2æ6öæ6B"æFFÒ¢6öç7B7&ÔFFÒvw&VvFT7&Õ&÷w2ÆÄ7&Õ&÷w2 ¢òòÖW&vRf6V&öö²6×vâ6÷W&6W2çFò6ævÆRtf6V&öö²rVçG'¢6öç7Böf$7&Ô¶W2Òö&¦V7Bæ¶W27&ÔFFç6÷W&6W2æfÇFW"²Óâ²ææ6ÇVFW2}zMyyzyy]zrrÇÂ²çFôÆ÷vW$66Rææ6ÇVFW2vf6V&öö²r¢böf$7&Ô¶W2æÆVæwFâ°¢6öç7Böf$ÖW&vVBÒ²F÷FÄÆVG3¢Â&VÆWfçDÆVG3¢Â'&VÆWfçDÆVG3¢ÂÖVWFæw566VGVÆVC¢ÂÖVWFæw46ö×ÆWFVC¢ÂÖVWFæw46æ6VÆÆVC¢Â&Vv7G&Föç3¢Â&Vv7G&FöåfÇVS¢Â6öçG&7G3¢Â6öçG&7EfÇVS¢Ð¢öf$7&Ô¶W2æf÷$V6²Óâ²ö&¦V7Bæ¶W2öf$ÖW&vVBæf÷$V6bÓâ²öf$ÖW&vVE¶eÒ³Ò7&ÔFFç6÷W&6W5¶µÕ¶eÒÇÂÒ²FVÆWFR7&ÔFFç6÷W&6W5¶µÒÒ¢7&ÔFFç6÷W&6W5²tf6V&öö²uÒÒöf$ÖW&vV@¢Ð¢òòÖW&vRvöövÆR6×vâ6÷W&6W2çFò6ævÆRtvöövÆRrVçG'¢6öç7Böt7&Ô¶W2Òö&¦V7Bæ¶W27&ÔFFç6÷W&6W2æfÇFW"²Óâ²ææ6ÇVFW2}y-y]y-yÂrÇÂ²çFôÆ÷vW$66Rææ6ÇVFW2vvöövÆRr¢böt7&Ô¶W2æÆVæwFâ°¢6öç7BötÖW&vVBÒ²F÷FÄÆVG3¢Â&VÆWfçDÆVG3¢Â'&VÆWfçDÆVG3¢ÂÖVWFæw566VGVÆVC¢ÂÖVWFæw46ö×ÆWFVC¢ÂÖVWFæw46æ6VÆÆVC¢Â&Vv7G&Föç3¢Â&Vv7G&FöåfÇVS¢Â6öçG&7G3¢Â6öçG&7EfÇVS¢Ð¢öt7&Ô¶W2æf÷$V6²Óâ²ö&¦V7Bæ¶W2ötÖW&vVBæf÷$V6bÓâ²ötÖW&vVE¶eÒ³Ò7&ÔFFç6÷W&6W5¶µÕ¶eÒÇÂÒ²FVÆWFR7&ÔFFç6÷W&6W5¶µÒÒ¢7&ÔFFç6÷W&6W5²tvöövÆRuÒÒötÖW&vV@¢Ð ¢òòFBÆFf÷&ÒÆVG2Fò5$ÒF÷FÇ0¢ÆWB÷ÆFf÷&Õ7VæBÒ ¢6öç7Böf%"Ò&W÷'G2æfÇFW""Óâ"æÖöçFÓÓÒ6VÆV7FVDÖöçFbb"ç6÷W&6RÓÓÒvf6V&öö²r¢6öç7Böu"Ò&W÷'G2æfÇFW""Óâ"æÖöçFÓÓÒ6VÆV7FVDÖöçFbb"ç6÷W&6Rbb"ç6÷W&6Rç7F'G5vFvvöövÆRr¢6öç7BöV×G6÷W&6RÒ²F÷FÄÆVG3¢Â&VÆWfçDÆVG3¢Â'&VÆWfçDÆVG3¢ÂÖVWFæw566VGVÆVC¢ÂÖVWFæw46ö×ÆWFVC¢ÂÖVWFæw46æ6VÆÆVC¢Â&Vv7G&Föç3¢Â&Vv7G&FöåfÇVS¢Â6öçG&7G3¢Â6öçG&7EfÇVS¢Ð¢böf%"æÆVæwFâ°¢ÆWBöf%&÷w2ÒµÓ²öf%"æf÷$V6"Óâ²b"æFFöf%&÷w2Òöf%&÷w2æ6öæ6B"æFFÒ¢6öç7Böf$vrÒvw&VvFU&÷w2öf%&÷w2¢÷ÆFf÷&Õ7VæB³Òöf$vrçF÷FÇ2ç7VæBÇÂ ¢6öç7Böf$ÆVG2Òöf$vrçF÷FÇ2æÆVG2ÇÂ ¢b7&ÔFFç6÷W&6W5²tf6V&öö²uÒ°¢7&ÔFFçF÷FÇ2çF÷FÄÆVG2³Òöf$ÆVG0¢7&ÔFFç6÷W&6W5²tf6V&öö²uÒÒ²ââåöV×G6÷W&6RÂF÷FÄÆVG3¢öf$ÆVG2Ð¢ÒVÇ6R°¢7&ÔFFçF÷FÇ2çF÷FÄÆVG2ÓÒ7&ÔFFç6÷W&6W5²tf6V&öö²uÒçF÷FÄÆVG2ÇÂ¢7&ÔFFçF÷FÇ2çF÷FÄÆVG2³Òöf$ÆVG0¢Ð¢Ð¢böu"æÆVæwFâ°¢ÆWBöu&÷w2ÒµÓ²öu"æf÷$V6"Óâ²b"æFFöu&÷w2Òöu&÷w2æ6öæ6B"æFFÒ¢6öç7BötvrÒvw&VvFU&÷w2öu&÷w2¢÷ÆFf÷&Õ7VæB³ÒötvrçF÷FÇ2ç7VæBÇÂ ¢6öç7BötÆVG2ÒötvrçF÷FÇ2æÆVG2ÇÂ ¢b7&ÔFFç6÷W&6W5²tvöövÆRuÒ°¢7&ÔFFçF÷FÇ2çF÷FÄÆVG2³ÒötÆVG0¢7&ÔFFç6÷W&6W5²tvöövÆRuÒÒ²ââåöV×G6÷W&6RÂF÷FÄÆVG3¢ötÆVG2Ð¢ÒVÇ6R°¢7&ÔFFçF÷FÇ2çF÷FÄÆVG2ÓÒ7&ÔFFç6÷W&6W5²tvöövÆRuÒçF÷FÄÆVG2ÇÂ¢7&ÔFFçF÷FÇ2çF÷FÄÆVG2³ÒötÆVG0¢Ð¢Ð ¢ÆWB&Wd7&ÔFFÒçVÆÀ¢b6ö×&TVæ&ÆVB°¢6öç7B&WdÖöçFÒvWE&WdÖöçF6VÆV7FVDÖöçF¢6öç7B&Wd7&Õ&W÷'G2Ò&W÷'G2æfÇFW""Óâ"æÖöçFÓÓÒ&WdÖöçFbb"ç6÷W&6RÓÓÒv7&Òr¢b&Wd7&Õ&W÷'G2æÆVæwFâ°¢ÆWB&We&÷w2ÒµÐ¢&Wd7&Õ&W÷'G2æf÷$V6"Óâ²&We&÷w2Ò&We&÷w2æ6öæ6B"æFFÇÂµÒÒ¢&Wd7&ÔFFÒvw&VvFT7&Õ&÷w2&We&÷w2¢Ð¢Ð ¢6öç7B7BÒ7&ÔFFçF÷FÇ0¢6öç7B7Ò&Wd7&ÔFFòçF÷FÇ0 ¢6öç7B7&Ô·ÒÆ&VÂÂfÇVRÂ6öÆ÷"Â7W'&VçBÂ&WbÂ46÷7BÓâ°¢6öç7B6Ò&WbÒçVÆÂò6ævUW&6VçB7W'&VçBÂ&WbÂ46÷7B¢çVÆÀ¢6öç7B6öç2Ò²}zyB-y²
yÍyy=yyÒs¢}yzrÂ}zyÍy]y]z
yyyyÒs¢~)ÈRrÂ}yÍy
zyÍy]y]z
yyyyÒs¢~)ØÂrÂ}zMy-yzy]z¢
zz­y]y
yíyRs¢}zMy"rÂ}zMy-yzy]z¢
zz­y]y
yíyRs¢}zyrÂ}zMy-yzy]z¢
zyy]yyÍyRs¢}yyrÂ}yMzzyíy]z¢s¢}yMzrÂ}zy]y]y
yMzzyíy]z¢s¢~(*¢rÂ}y}y]ymyyÒs¢}y}ybrÂ}zy]y]y
y}y]ymyyÒs¢~(*¢rÂ}y
y}y]yb
yMyízyB
yÍzMy-yzyB
zz­y]y
yíyBs¢rRrÂ}y
y}y]yb
yMyízyB
yÍzMy-yzy]z¢
zyy]zmz-yRs¢rRrÂrR
zyÍy]y]z
yyy]z¢s¢rRrÂ}z-yÍy]z¢
zMy-yzyB
zyy]zmz-yBs¢~(*¢rÐ¢6öç7B6öâÒ6öç5¶Æ&VÅÒÇÂ	ù8¢p¢6öç7B·6öÆ÷'2Ò²w&VVã¢w&v&bÃRÃ#ÃãrÂW'ÆS¢w&v&3Ã"Ã#CbÃãrÂ÷&ævS¢w&v&#CRÃSÃÃãrÂæ³¢w&v&#3bÃs"ÃS2ÃãrÂ7ã¢w&v&bÃ"Ã#"ÃãrÂ&VC¢w&v&#3ÃcÃcÃãrÐ¢6öç7B·FWD6öÆ÷'2Ò²w&VVã¢wf"×7V66W72rÂW'ÆS¢wf"Ò×W'ÆRrÂ÷&ævS¢wf"Ò×v&æærrÂæ³¢wf"Ò×æ²rÂ7ã¢wf"ÒÖ7ârÂ&VC¢wf"ÒÖFævW"rÐ¢&WGW&âÆFb6Æ74æÖS×¶·Ö6&BG¶6öÆ÷'ÖÒ¶W×¶Æ&VÇÓãÆFb6Æ74æÖSÒ&·Ö66VçB#ãÂöFcãÆFb6Æ74æÖSÒ&·Ö6öâ"7GÆS×·¶&6¶w&÷VæC¢·6öÆ÷'5¶6öÆ÷%ÒÇÂw&v&SÃ3Ã#CbÃãrÂ6öÆ÷#¢·FWD6öÆ÷'5¶6öÆ÷%ÒÇÂwf"ÒÖ66VçBw×Óç¶6öçÓÂöFcãÆFb6Æ74æÖSÒ&·ÖÆ&VÂ#ç¶f÷&ÖDçVÒ7BçF÷FÄÆVG2ÓÂöFcãÆFb6Æ74æÖSÒ&·×fÇVR#ç·fÇVWÓÂöFcç¶6bbÆFb6Æ74æÖS×¶·Ö6ævRG¶6æ4vööBòwWr¢vF÷vâwÖÓãÇ7â6Æ74æÖSÒ&'&÷r#ç¶6ç7Bâò~)k"r¢~)kÂwÓÂ÷7ãâ´ÖFæ'26ç7BçFôfVBÒSÂöFcçÓÂöFcà¢Ð ¢6öç7B6÷W&6TVçG&W2Òö&¦V7BæVçG&W27&ÔFFç6÷W&6W2ç6÷'BÂ"Óâ%³ÒçF÷FÄÆVG2Ò³ÒçF÷FÄÆVG2¢6öç7B6÷W&6TæÖW2Ò6÷W&6TVçG&W2æÖ¶æÖUÒÓâæÖR ¢6WEFÖV÷WBÓâ°¢FW7G&÷6'G2¢b6÷W&6TæÖW2æÆVæwFâ°¢7&VFT6'Bv7&ÕT6'BrÂvF÷VvçWBrÂ6÷W&6TæÖW2Â·°¢FF¢6÷W&6TæÖW2æÖâÓâ7&ÔFFç6÷W&6W5¶åÒçF÷FÄÆVG2À¢&6¶w&÷VæD6öÆ÷#¢4ôÄõ%2ç6Æ6RÂ6÷W&6TæÖW2æÆVæwF¢ÕÒ¢Ð¢ÒÂ# ¢&WGW&â¢Ãà¢ÆFb6Æ74æÖSÒ&·Öw&B#à¢¶7&Ô·}zyB-y²
yÍyy=yyÒrÂf÷&ÖDçVÒ7BçF÷FÄÆVG2ÂrrÂ7BçF÷FÄÆVG2Â7òçF÷FÄÆVG2Ð¢¶7&Ô·}zyÍy]y]z
yyyyÒrÂf÷&ÖDçVÒ7Bç&VÆWfçDÆVG2Âvw&VVârÂ7Bç&VÆWfçDÆVG2Â7òç&VÆWfçDÆVG2Ð¢¶7&Ô·}yÍy
zyÍy]y]z
yyyyÒrÂf÷&ÖDçVÒ7Bæ'&VÆWfçDÆVG2Âw&VBrÂ7Bæ'&VÆWfçDÆVG2Â7òæ'&VÆWfçDÆVG2ÂG'VRÐ¢¶7&Ô·rR
zyÍy]y]z
yyy]z¢rÂ7Bç&VÆWfçE&FRçFôfVB²rRrÂv7ârÂ7Bç&VÆWfçE&FRÂ7òç&VÆWfçE&FRÐ¢¶7&Ô·}zMy-yzy]z¢
zz­y]y
yíyRrÂf÷&ÖDçVÒ7BæÖVWFæw566VGVÆVBÂwW'ÆRrÂ7BæÖVWFæw566VGVÆVBÂ7òæÖVWFæw566VGVÆVBÐ¢¶7&Ô·}zMy-yzy]z¢
zyy]zmz-yRrÂf÷&ÖDçVÒ7BæÖVWFæw46ö×ÆWFVBÂv÷&ævRrÂ7BæÖVWFæw46ö×ÆWFVBÂ7òæÖVWFæw46ö×ÆWFVBÐ¢¶7&Ô·}y
y}y]yb
yMyízyB
yÍzMy-yzyB
zz­y]y
yíyBrÂ7Bç66VGVÆVE&FRçFôfVB²rRrÂwæ²rÂ7Bç66VGVÆVE&FRÂ7òç66VGVÆVE&FRÐ¢¶7&Ô·}y
y}y]yb
yMyízyB
yÍzMy-yzy]z¢
zyy]zmz-yRrÂ7Bæ6ö×ÆWFVE&FRçFôfVB²rRrÂrrÂ7Bæ6ö×ÆWFVE&FRÂ7òæ6ö×ÆWFVE&FRÐ¢¶7&Ô·}z-yÍy]z¢
zMy-yzyB
zyy]zmz-yBrÂ7BæÖVWFæw46ö×ÆWFVBâòf÷&ÖD7W'&Væ7÷ÆFf÷&Õ7VæBò7BæÖVWFæw46ö×ÆWFVB¢~(*£rÂwW'ÆRrÂÂÐ¢¶7&Ô·}zMy-yzy]z¢
zyy]yyÍyRrÂf÷&ÖDçVÒ7BæÖVWFæw46æ6VÆÆVBÂw&VBrÂ7BæÖVWFæw46æ6VÆÆVBÂ7òæÖVWFæw46æ6VÆÆVBÂG'VRÐ¢¶7&Ô·}yMzzyíy]z¢rÂf÷&ÖDçVÒ7Bç&Vv7G&Föç2Âvw&VVârÂ7Bç&Vv7G&Föç2Â7òç&Vv7G&Föç2Ð¢¶7&Ô·}zy]y]y
yMzzyíy]z¢rÂf÷&ÖD7W'&Væ77Bç&Vv7G&FöåfÇVRÂwW'ÆRrÂ7Bç&Vv7G&FöåfÇVRÂ7òç&Vv7G&FöåfÇVRÐ¢¶7&Ô·}y}y]ymyyÒrÂf÷&ÖDçVÒ7Bæ6öçG&7G2Âv7ârÂ7Bæ6öçG&7G2Â7òæ6öçG&7G2Ð¢¶7&Ô·}zy]y]y
y}y]ymyyÒrÂf÷&ÖD7W'&Væ77Bæ6öçG&7EfÇVRÂv÷&ævRrÂ7Bæ6öçG&7EfÇVRÂ7òæ6öçG&7EfÇVRÐ¢ÂöFcà ¢²ò¢5$ÒgVææVÂ¢÷Ð¢ÆFb6Æ74æÖSÒ'6V7Föâ#à¢ÆFb6Æ74æÖSÒ'6V7FöâÖVFW""7GÆS×·¶F7Æ¢vfÆWrÆÆväFV×3¢v6VçFW"rÆv¢s'rÆÖ&vä&÷GFöÓ¢s#w×Óà¢ÆFb6Æ74æÖSÒ'6V7FöâÖ6öâ"7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓ"w×Óï	ùx.ûóÂöFcà¢ÆFcãÆ"7GÆS×·¶föçE6¦S¢sã6VÒrÆföçEvVvC£sÆ6öÆ÷#¢wf"Ò×&Ö'rÆÖ&vã£×ÓíyízzMy¢
yÍyy=yyÓÂö#ãÆFb7GÆS×·¶föçE6¦S¢sãVVÒrÆ6öÆ÷#¢wf"Ò×FWB×6V6öæF'w×ÓíyíyÍyy2
y]z-y2
y}y]ymyCÂöFcãÂöFcà¢ÂöFcà¢ÆFb6Æ74æÖSÒ&6&B"7GÆS×··FFæs¢s#Gw×Óà¢ÆFb6Æ74æÖSÒ&gVææVÂ#à¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓw×Óç¶f÷&ÖDçVÒ7BçF÷FÄÆVG2ÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#ízyB-y²
yÍyy=yyÓÂöFcãÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂÖ'&÷r#î(iÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖ66VçBrÆ÷6G£ãW×Óç¶f÷&ÖDçVÒ7Bç&VÆWfçDÆVG2ÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#ízyÍy]y]z
yyyyÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂ×&FR#ç¶7Bç&VÆWfçE&FRçFôfVBÒSÂöFcãÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂÖ'&÷r#î(iÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"×'WÆRw×Óç¶f÷&ÖDçVÒ7BæÖVWFæw566VGVÆVBÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#ízyÍy]y]z
yyyyÒW7VGVÆVB
ymyCÂöFcãÆFb6Æ74æÖSÒ&gVææVÂ×&FR#ç¶7Bç66VGVÆVE&FRçFôfVBÒSÂöFcãÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂÖ'&÷r#ë@ð½¥Øø(ñ¥Ø±ÍÍ9µôÕ¹¹°µÍÑÀøñ¥Ø±ÍÍ9µôÕ¹¹°µÈÍÑå±õíí­É½Õ¹èÙÈ ´µÉ¥¹Ð´È¤õôùí½ÉµÑ9Õ´¡Ð¹µÑ¥¹Í
½µÁ±Ñ¥ôð½¥Øøñ¥Ø±ÍÍ9µôÕ¹¹°µ±°ú×××¦×¢×</div><div className="funnel-rate">{ct.completedRate.toFixed(1)}%</div></div>
              <div className="funnel-arrow">â</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-4)'}}>{formatNum(ct.registrations)}</div><div className="funnel-label">××¨×©×××ª</div></div>
              <div className="funnel-arrow">â</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-3)'}}>{formatNum(ct.contracts)}</div><div className="funnel-label">×××××</div></div>
            </div>
            <div style={{textAlign:'center',marginTop:'10px',fontSize:'0.85em',color:'var(--text-secondary)'}}>
              ×©××× ××¨×©×××ª: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(ct.registrationValue)}</strong> &nbsp;|&nbsp; ×©××× ×××××: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(ct.contractValue)}</strong>
            </div>
          </div>
        </div>

        {/* CRM Table by Source */}
        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>ð</div>× ×ª×× ×× ××¤× ××§××¨ ×××¢×</div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr>
                <th>××§××¨</th>
                <th>×¡×"× ×××××</th>
                <th>×¨×××× ××××</th>
                <th>×× ×¨×××× ××××</th>
                <th>×ª××××</th>
                <th>% ×ª××××</th>
                <th>×××¦×¢×</th>
                <th>% ××××¦×¢×</th>
                <th=yy]yyÍySÂ÷Fà¢ÇFíyMzzyíy]z£Â÷Fà¢ÇFízy]y]y
yMzzyíy]z£Â÷Fà¢ÇFíy}y]ymyyÓÂ÷Fà¢ÇFízy]y]y
y}y]ymyyÓÂ÷Fà¢Â÷G#ãÂ÷FVCà¢ÇF&öGà¢·6÷W&6TVçG&W2æÖ¶æÖRÂEÒÓâ°¢6öç7B66VE&FRÒBçF÷FÄÆVG2âòBæÖVWFæw566VGVÆVBòBçF÷FÄÆVG2¢çFôfVB¢sãp¢6öç7B6ö×&FRÒBçF÷FÄÆVG2âòBæÖVWFæw46ö×ÆWFVBòBçF÷FÄÆVG2¢çFôfVB¢sãp¢&WGW&â¢ÇG"¶W×¶æÖWÓà¢ÇFB7GÆS×·¶föçEvVvC£c×Óç¶æÖWÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBçF÷FÄÆVG2ÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBç&VÆWfçDÆVG2ÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBæ'&VÆWfçDÆVG2ÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBæÖVWFæw566VGVÆVBÓÂ÷FCà¢ÇFCç·66VE&FWÒSÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBæÖVWFæw46ö×ÆWFVBÓÂ÷FCà¢ÇFCç¶6ö×&FWÒSÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBæÖVWFæw46æ6VÆÆVBÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBç&Vv7G&Föç2ÓÂ÷FCà¢ÇFCç¶f÷&ÖD7W'&Væ7Bç&Vv7G&FöåfÇVRÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒBæ6öçG&7G2ÓÂ÷FCà¢ÇFCç¶f÷&ÖD7W'&Væ7Bæ6öçG&7EfÇVRÓÂ÷FCà¢Â÷G#à¢¢ÒÐ¢ÇG"7GÆS×·¶föçEvVvC£sÆ&6¶w&÷VæC¢wf"ÒÖ&r×6V6öæF'w×Óà¢ÇFCízyB-y³Â÷FCà¢ÇFCç¶f÷&ÖDçVÒ7BçF÷FÄÆVG2ÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒ7Bç&VÆWfçDÆVG2ÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒ7Bæ'&VÆWfçDÆVG2ÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒ7BæÖVWFæw566VGVÆVBÓÂ÷FCà¢ÇFCç¶7Bç66VGVÆVE&FRçFôfVBÒSÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒ7BæÖVWFæw46ö×ÆWFVBÓÂ÷FCà¢ÇFCç¶7Bæ6ö×ÆWFVE&FRçFôfVBÒSÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒ7BæÖVWFæw46æ6VÆÆVBÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒ7Bç&Vv7G&Föç2ÓÂ÷FCà¢ÇFCç¶f÷&ÖD7W'&Væ77Bç&Vv7G&FöåfÇVRÓÂ÷FCà¢ÇFCç¶f÷&ÖDçVÒ7Bæ6öçG&7G2ÓÂ÷FCà¢ÇFCç¶f÷&ÖD7W'&Væ77Bæ6öçG&7EfÇVRÓÂ÷FCà¢Â÷G#à¢Â÷F&öGà¢Â÷F&ÆSà¢ÂöFcà¢ÂöFcà ¢²ò¢5$Ò6'G2¢÷Ð¢ÆFb6Æ74æÖSÒ'6V7Föâ#à¢ÆFb6Æ74æÖSÒ'6V7Föâ×FFÆR#ãÆFb6Æ74æÖSÒ'6V7FöâÖ6öâ"7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓ"w×Óï	ù8ÂöFcíy-zzMyyÓÂöFcà¢ÆFb6Æ74æÖSÒ&6'BÖw&B"7GÆS×·¶w&EFV×ÆFT6öÇVÖç3¢sg"w×Óà¢ÆFb6Æ74æÖSÒ&6'BÖ6&B#ãÆCï	úz
yMz­zMyÍy-y]z¢
yÍyy=yyÓÂöCãÆFb6Æ74æÖSÒ&6'BÖ6öçFæW"#ãÆ6çf2CÒ&7&ÕT6'B#ãÂö6çf3ãÂöFcãÂöFcà¢ÂöFcà¢ÂöFcà¢Âóà¢¢ÒÂ·6VÆV7FVDÖöçFÂ6ö×&TVæ&ÆVBÂ&W÷'G5Ò ¢òòÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÒÔâD4$ô$BÆÂöf6V&öö²övöövÆRF'2ÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÓÐ¢6öç7B&VæFW$F6&ö&BÒW6T6ÆÆ&6²Óâ°¢b6VÆV7FVDÖöçFÇÂ&W÷'G2æÆVæwFÓÓÒ&WGW&âçVÆÀ¢FW7G&÷6'G2 ¢6öç7B7W'&VçE&W÷'G2Ò&W÷'G2æfÇFW""Óâ"æÖöçFÓÓÒ6VÆV7FVDÖöçF¢b7W'&VçE&W÷'G2æÆVæwFÓÓÒ&WGW&âÆFb6Æ74æÖSÒ'vVÆ6öÖRÖ6VçFW"#ãÆFb6Æ74æÖSÒ&6öâ#ï	ù:ÓÂöFcãÆ3íy
yyò
z
z­y]z
yyÒ
yÍy}y]y=z
ymyCÂö3ãÂöFcà ¢6öç7BF7Æ&W÷'G2ÒF6F"ÓÓÒvÆÂp¢ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÒv7&Òrbb"ç6÷W&6RÓÒv7&Õ÷&W÷'G2r¢¢F6F"ÓÓÒvf6V&öö²p¢ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒvf6V&öö²r¢¢F6F"ÓÓÒvvöövÆU÷Öp¢ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒvvöövÆU÷Ör¢¢F6F"ÓÓÒvvöövÆU÷6V&6p¢ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒvvöövÆU÷6V&6r¢¢F6F"ÓÓÒvvöövÆRp¢ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6Rbb"ç6÷W&6Rç7F'G5vFvvöövÆRr¢¢µÐ¢6öç7B5ÖÒF6F"ÓÓÒvvöövÆU÷ÖrÇÂF6F"ÓÓÒvvöövÆRrbbF7Æ&W÷'G2æÆVæwFâbbF7Æ&W÷'G2æWfW'"Óâ"ç6÷W&6RÓÓÒvvöövÆU÷Ör ¢ÆWBÆÅ&÷w2ÒµÐ¢F7Æ&W÷'G2æf÷$V6"Óâ²b"æFFÆÅ&÷w2ÒÆÅ&÷w2æ6öæ6B"æFFÒ¢6öç7BFFÒvw&VvFU&÷w2ÆÅ&÷w2 ¢òòFB5$ÒÆVG2Fò&ÆÂ"F"F÷FÇ0¢ÆWB7&ÕF÷FÄÆVG2Ò ¢bF6F"ÓÓÒvÆÂr°¢6öç7B7&Õ&W÷'G2Ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒv7&Òr¢7&Õ&W÷'G2æf÷$V6"Óâ°¢b"æFF°¢"æFFæf÷$V6&÷rÓâ²7&ÕF÷FÄÆVG2³ÒGVöb&÷rçF÷FÄÆVG2ÓÓÒvçVÖ&W"rò&÷rçF÷FÄÆVG2¢'6TfÆöB7G&ær&÷rçF÷FÄÆVG2ç&WÆ6RõµãÓåÂÕÒörÂrrÇÂÒ¢Ð¢Ò¢Ð ¢òòWG&7B5$ÒF÷FÇ2f÷"&ÆÂ"F"µF7Æ¢ÆWB7&ÕF÷FÇ2ÒçVÆÀ¢bF6F"ÓÓÒvÆÂr°¢6öç7B7&Õ&W2Ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒv7&Òr¢b7&Õ&W2æÆVæwFâ°¢ÆWBÆÄ7&Õ"ÒµÐ¢7&Õ&W2æf÷$V6"Óâ²b"æFFÆÄ7&Õ"ÒÆÄ7&Õ"æ6öæ6B"æFFÒ¢7&ÕF÷FÇ2Òvw&VvFT7&Õ&÷w2ÆÄ7&Õ"çF÷FÇ0¢Ð¢Ð ¢ÆWB&WdFFÒçVÆÀ¢b6ö×&TVæ&ÆVB°¢6öç7B&WdÖöçFÒvWE&WdÖöçF6VÆV7FVDÖöçF¢6öç7B&We&W÷'G2Ò&W÷'G2æfÇFW""Óâ"æÖöçFÓÓÒ&WdÖöçF¢6öç7BF7Æ&WbÒF6F"ÓÓÒvÆÂp¢ò&We&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÒv7&Òr¢¢F6F"ÓÓÒvf6V&öö²p¢ò&We&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒvf6V&öö²r¢¢F6F"ÓÓÒvvöövÆU÷Öp¢ò&We&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒvvöövÆU÷Ör¢¢F6F"ÓÓÒvvöövÆU÷6V&6p¢ò&We&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒvvöövÆU÷6V&6r¢¢&We&W÷'G2æfÇFW""Óâ"ç6÷W&6Rbb"ç6÷W&6Rç7F'G5vFvvöövÆRr¢bF7Æ&WbæÆVæwF²ÆWB&We&÷w2ÒµÓ²F7Æ&Wbæf÷$V6"Óâ²&We&÷w2Ò&We&÷w2æ6öæ6B"æFFÇÂµÒÒ²&WdFFÒvw&VvFU&÷w2&We&÷w2Ð¢Ð ¢6öç7BÆÄÖöçF2Ò²ââææWr6WB&W÷'G2æÖ"Óâ"æÖöçFÒç6÷'B¢6öç7BG&VæDFFÒÆÄÖöçF2æÖÒÓâ°¢ÆWBÕ&÷w2ÒµÐ¢&W÷'G2æfÇFW""Óâ"æÖöçFÓÓÒÒbb"ç6÷W&6RÓÒv7&Òrbb"ç6÷W&6RÓÒv7&Õ÷&W÷'G2ræf÷$V6"Óâ²Õ&÷w2ÒÕ&÷w2æ6öæ6B"æFFÇÂµÒÒ¢&WGW&â²ÖöçF¢ÒÂââævw&VvFU&÷w2Õ&÷w2çF÷FÇ2Ð¢Ò ¢6öç7BBÒFFçF÷FÇ0¢6öç7BÒ&WdFFòçF÷FÇ0 ¢6öç7B·6öç2Ò²}yMy]zmy
yBs¢~(*¢rÂ}z­z}zmyys¢~(*¢rÂ}yÍyy=yyÒs¢	ùRrÂt5Âs¢	ù+rÂ}z-yÍy]z¢
yÍyÍyy2s¢	ù+rÂ}y}zyzMy]z¢s¢	ùrÂ}z­zMy]zmyBs¢	ù:rÂ}z}yÍyz}yyÒs¢	ùkrÂt52s¢	ù+rÂt5Òs¢	ù8¢rÂt5E"s¢	ù8rÂ}yMyízyBs¢	ùHBrÂ}z­y=yzy]z¢s¢	ùHBrÂ}zMy-yzy]z¢
zz­y]y
yíyRs¢	ù8RrÂ}zMy-yzy]z¢
zyy]zmz-yRs¢~)ÈRrÂ}yMzzyíy]z¢s¢	ù9ÒrÂ}y}y]ymyyÒs¢	ù8BrÐ¢6öç7B·6öÆ÷'2Ò²w&VVã¢w&v&bÃRÃ#ÃãrÂW'ÆS¢w&v&3Ã"Ã#CbÃãrÂ÷&ævS¢w&v&#CRÃSÃÃãrÂæ³¢w&v&#3bÃs"ÃS2ÃãrÂ7ã¢w&v&bÃ"Ã#"ÃãrÂ&VC¢w&v&#3ÃcÃcÃãrÐ¢6öç7B·FWD6öÆ÷'2Ò²w&VVã¢wf"Ò×7V66W72rÂW'ÆS¢wf"Ò×W'ÆRrÂ÷&ævS¢wf"Ò×v&æærrÂæ³¢wf"Ò×æ²rÂ7ã¢wf"ÒÖ7ârÂ&VC¢wf"ÒÖFævW"rÐ ¢6öç7B·ÒÆ&VÂÂfÇVRÂ6öÆ÷"Â7W'&VçBÂ&WbÂ46÷7BÓâ°¢6öç7B6Ò&WbÒçVÆÂò6ævUW&6VçB7W'&VçBÂ&WbÂ46÷7B¢çVÆÀ¢6öç7B6öâÒ·6öç5¶Æ&VÅÒÇÂ	ù8¢p¢&WGW&âÆFb6Æ74æÖS×¶·Ö6&BG¶6öÆ÷'ÖÒ¶W×¶Æ&VÇÓãÆFb6Æ74æÖSÒ&·Ö66VçB#ãÂöFcãÆFb6Æ74æÖSÒ&·Ö6öâ"7GÆS×·¶&6¶w&÷VæC¢·6öÆ÷'5¶6öÆ÷%ÒÇÂw&v&SÃ3Ã#CbÃãrÂ6öÆ÷#¢·FWD6öÆ÷'5¶6öÆ÷%ÒÇÂwf"ÒÖ66VçBw×Óç¶6öçÓÂöFcãÆFb6Æ74æÖSÒ&·ÖÆ&VÂ#ç¶Æ&VÇÓÂöFcãÆFb6Æ74æÖSÒ&·×fÇVR#ç·fÇVWÓÂöFcç¶6bbÆFb6Æ74æÖS×¶·Ö6ævRG¶6æ4vööBòwWr¢vF÷vâwÖÓãÇ7â6Æ74æÖSÒ&'&÷r#ç¶6ç7Bâò~)k"r¢~)kÂwÓÂ÷7ãâ´ÖFæ'26ç7BçFôfVBÒSÂöFcçÓÂöFcà¢Ð ¢6öç7B'VÆEF&ÆRÒFV×2Â&WdFV×2ÂÆ&VÄæÖRÂF&ÆTBÓâ°¢bFV×2ÇÂö&¦V7Bæ¶W2FV×2æÆVæwFÓÓÒ&WGW&âçVÆÀ¢6öç7B6öÇ2Ò·¶¶W¢væÖRrÆÆ&VÃ¦Æ&VÄæÖRÆvWC¢òÆâÓæçÒÇ¶¶W¢v6Æ6·2rÆÆ&VÃ¢}z}yÍyz}yyÒrÆvWC¦CÓæBæ6Æ6·2ÆvW#§G'VWÒÇ¶¶W¢v×&W76öç2rÆÆ&VÃ¢}y}zyzMy]z¢rÆvWC¦CÓæBæ×&W76öç2ÆvW#§G'VWÒÇ¶¶W¢v72rÆÆ&VÃ¢}z-yÍy]z¢
yÍz}yÍyzrrÆvWC¦CÓæBæ6Æ6·3ãöBç7VæBöBæ6Æ6·3£ÆvW#¦fÇ6WÒÇ¶¶W¢v7G"rÆÆ&VÃ¢t5E"rÆvWC¦CÓæBæ×&W76öç3ãòBæ6Æ6·2öBæ×&W76öç2££ÆvW#§G'VWÒÇ¶¶W¢v7ÒrÆÆ&VÃ¢t5ÒrÆvWC¦CÓæBæ×&W76öç3ãòBç7VæBöBæ×&W76öç2££ÆvW#¦fÇ6WÒÇ¶¶W¢vÆVG2rÆÆ&VÃ¢}yÍyy=yyÒrÆvWC¦CÓæBæÆVG2ÆvW#§G'VWÒÇ¶¶W¢v7ÂrÆÆ&VÃ¢}z-yÍy]z¢
yÍyÍyy2rÆvWC¦CÓæBæÆVG3ãöBç7VæBöBæÆVG3£ÆvW#¦fÇ6WÒÇ¶¶W¢w7VæBrÆÆ&VÃ¢}z­z}zmyy
zz
y]zmyÂrÆvWC¦CÓæBç7VæGÕÐ¢6öç7B62Ò6÷'D6öæfu·F&ÆTEÐ¢ÆWBVçG&W2Òö&¦V7BæVçG&W2FV×2¢b62²6öç7B6öÂÒ6öÇ2æfæB3Óæ2æ¶WÓÓ×62æ¶W²b6öÂ¶VçG&W2ç6÷'BÆ"Óç¶6öç7BfÖ6öÂævWB³ÒÆ³ÒÇf#Ö6öÂævWB%³ÒÆ%³Ò¶bGVöbfÓÓÒw7G&ærr&WGW&â62æF#ÓÓÒv62s÷fæÆö6ÆT6ö×&Rf"§f"æÆö6ÆT6ö×&Rf·&WGW&â62æF#ÓÓÒv62s÷f×f#§f"×f·Ò·×ÒVÇ6R²VçG&W2ç6÷'BÂ"Óâ%³Òç7VæBÒ³Òç7VæBÐ¢6öç7B6÷t6Ò6ö×&TVæ&ÆVBbb&WdFV×0¢6öç7B6Ò7W"Â&WbÂ46÷7BÓâ°¢b6÷t6ÇÂ&WbÓÒçVÆÂ&WGW&âçVÆÀ¢6öç7B7BÒ6ævUW&6VçB7W"Â&WbÂ46÷7B¢b7B&WGW&âçVÆÀ¢6öç7B5÷2Ò46÷7Bò7Bç7BÂ¢7Bç7Bâ ¢&WGW&âÇ7â6Æ74æÖS×¶6ævRÖ&FvRG¶5÷2òw÷6FfRr¢væVvFfRwÖÓç·7Bç7Bâò~)k"r¢~)kÂwÒ´ÖFæ'27Bç7BçFôfVBÒSÂ÷7ãà¢Ð¢6öç7B6÷'D6öâÒ¶WÓâ²b67ÇÇ62æ¶WÓÖ¶W&WGW&âr(xRs²&WGW&â62æF#ÓÓÒvFW62sòr)kÂs¢r)k"rÐ¢6öç7BF7GÆRÒ¶7W'6÷#¢wöçFW"rÇW6W%6VÆV7C¢væöæRrÇvFU76S¢væ÷w&wÐ¢6öç7BWG&VÖW2Ò·Ð¢6öÇ2æf÷$V62Óâ²b2æ¶WÓÓÒvæÖRrÇÂ2æ¶WÓÓÒw7VæBr&WGW&ã²6öç7BfÇ2ÒVçG&W2æÖ¶âÆEÒÓâ2ævWBBÆâæfÇFW"bÓâGVöbbÓÓÒvçVÖ&W"rbbbâ²bfÇ2æÆVæwFÂ"&WGW&ã²WG&VÖW5¶2æ¶WÒÒ²Öã¢ÖFæÖâââçfÇ2ÂÖ¢ÖFæÖââçfÇ2ÒÒ¢6öç7B6VÆÄ&rÒ¶WÂfÂÓâ²6öç7BRÒWG&VÖW5¶¶WÓ²bRÇÂfÂÃÒÇÂRæÖâÓÓÒRæÖ&WGW&â·Ó²6öç7B6öÂÒ6öÇ2æfæB3Óæ2æ¶WÓÓÖ¶W²b6öÂÇÂ6öÂævW"ÓÓÒVæFVfæVB&WGW&â·Ó²bfÂÓÓÒRæÖ&WGW&â6öÂævW"ò²6öÆ÷#¢r3SccrÆföçEvVvC£sÒ¢¶6öÆ÷#¢r6F3#c#brÆföçEvVvC£sÓ²bfÂÓÓÒRæÖâ&WGW&â6öÂævW"ò¶6öÆ÷#¢r6F3#c#brÆföçEvVvC£sÒ¢¶6öÆ÷#¢r3SccrÆföçEvVvC£sÓ²&WGW&â·ÒÐ¢&WGW&âÆFb6Æ74æÖSÒ'F&ÆR×w&W"#ãÇF&ÆR6Æ74æÖSÒ&FF×F&ÆR#ãÇFVCãÇG#ç¶6öÇ2æÖ3ÓâÇF¶W×¶2æ¶WÒ7GÆS×·F7GÆWÒöä6Æ6³×²ÓææFÆU6÷'BF&ÆTBÆ2æ¶WÓç¶2æÆ&VÇ×·6÷'D6öâ2æ¶WÓÂ÷FâÓÂ÷G#ãÂ÷FVCãÇF&öGç¶VçG&W2æÖ¶æÖRÂEÒÓâ²6öç7B7ÂÒBæÆVG2âòBç7VæBòBæÆVG2¢²6öç7B72ÒBæ6Æ6·2âòBç7VæBòBæ6Æ6·2¢²6öç7B7G"ÒBæ×&W76öç2âòBæ6Æ6·2òBæ×&W76öç2¢¢²6öç7B7ÒÒBæ×&W76öç2âòBç7VæBòBæ×&W76öç2¢¢²6öç7B7Ä6Æ72Ò7Ââbb7ÂÂòwFrÖw&VVâr¢7ÂÂ#òwFrÖ&ÇVRr¢7ÂÂSòwFr×W'ÆRr¢wFr×&VBs²&WGW&âÇG"¶W×¶æÖWÓãÇFB7GÆS×·¶föçEvVvC¢c×Óç¶æÖWÓÂ÷FCãÇFB7GÆS×¶6VÆÄ&rv6Æ6·2rÆBæ6Æ6·2Óç¶f÷&ÖDçVÒBæ6Æ6·2Ò¶6Bæ6Æ6·2Â&WdFV×3òå¶æÖUÓòæ6Æ6·2ÂfÇ6RÓÂ÷FCãÇFB7GÆS×¶6VÆÄ&rv×&W76öç2rÆBæ×&W76öç2Óç¶f÷&ÖDçVÒBæ×&W76öç2Ò¶6Bæ×&W76öç2Â&WdFV×3òå¶æÖUÓòæ×&W76öç2ÂfÇ6RÓÂ÷FCãÇFB7GÆS×¶6VÆÄ&rv72rÆ72Óç¶f÷&ÖD7W'&Væ772Ò¶672Â&WdFV×3òå¶æÖUÓòæ6Æ6·2âò&WdFV×5¶æÖUÒç7VæB÷&WdFV×5¶æÖUÒæ6Æ6·2¢çVÆÂÂG'VRÓÂ÷FCãÇFB7GÆS×¶6VÆÄ&rv7G"rÆ7G"Óç¶7G"çFôfVB"ÒSÂ÷FCãÇFB7GÆS×¶6VÆÄ&rv7ÒrÆ7ÒÓç¶f÷&ÖD7W'&Væ77ÒÓÂ÷FCãÇFB7GÆS×¶6VÆÄ&rvÆVG2rÆBæÆVG2Óç¶BæÆVG7Ò¶6BæÆVG2Â&WdFV×3òå¶æÖUÓòæÆVG2ÂfÇ6RÓÂ÷FCãÇFB7GÆS×¶6VÆÄ&rv7ÂrÆ7ÂÓãÇ7â6Æ74æÖS×¶7Â×FrG¶7Ä6Æ77ÖÓç¶f÷&ÖD7W'&Væ77ÂÓÂ÷7ããÂ÷FCãÇFCç¶f÷&ÖD7W'&Væ7Bç7VæBÒ¶6Bç7VæBÂ&WdFV×3òå¶æÖUÓòç7VæBÂG'VRÓÂ÷FCãÂ÷G#âÒÓÂ÷F&öGãÂ÷F&ÆSãÂöFcâ¢Ð ¢6WEFÖV÷WBÓâ°¢FW7G&÷6'G2¢bG&VæDFFæÆVæwFâ°¢6öç7BÆ&VÇ2ÒG&VæDFFæÖBÓâf÷&ÖDÖöçFBæÖöçF¢7&VFT6'BwG&VæDÆVG2rÂv&"rÂÆ&VÇ2Â·²Æ&VÃ¢tÆVG2rÂFF¢G&VæDFFæÖBÓâBæÆVG2Â&6¶w&÷VæD6öÆ÷#¢w&v&SÃ3Ã#CbÃãrrÂ4C¢wrÒÂ²Æ&VÃ¢t5ÂrÂFF¢G&VæDFFæÖBÓâBæ7ÂÂ&÷&FW$6öÆ÷#¢r6VcCCCBrÂGS¢vÆæRrÂ4C¢wrÂFVç6öã¢ã2ÂöçE&FW3¢RÕÒÂ²¢²÷6Föã¢w&vBrÒÂ¢²÷6Föã¢vÆVgBrÂw&C¢²G&töä6'D&V¢fÇ6RÒÒÒ¢7&VFT6'BwG&VæE7VæBrÂv&"rÂÆ&VÇ2Â·²Æ&VÃ¢t'VFvWBrÂFF¢G&VæDFFæÖBÓâBç7VæBÂ&6¶w&÷VæD6öÆ÷#¢w&v&3Ã"Ã#CbÃãrrÂ4C¢wrÒÂ²Æ&VÃ¢t×&W76öç2rÂFF¢G&VæDFFæÖBÓâBæ×&W76öç2Â&÷&FW$6öÆ÷#¢r3f#fCBrÂGS¢vÆæRrÂ4C¢wrÂFVç6öã¢ã2ÂöçE&FW3¢RÕÒÂ²¢²÷6Föã¢w&vBrÒÂ¢²÷6Föã¢vÆVgBrÂw&C¢²G&töä6'D&V¢fÇ6RÒÒÒ¢Ð¢6öç7B6×æÖW3"Òö&¦V7Bæ¶W2FFæ6×vç2¢b6×æÖW3"æÆVæwFâ°¢7&VFT6'Bv6×7VæBrÂvF÷VvçWBrÂ6×æÖW3"Â·²FF¢6×æÖW3"æÖâÓâFFæ6×vç5¶åÒç7VæBÂ&6¶w&÷VæD6öÆ÷#¢4ôÄõ%2ç6Æ6RÂ6×æÖW3"æÆVæwFÕÒ¢7&VFT6'Bv6×ÆVG2rÂv&"rÂ6×æÖW3"Â·²Æ&VÃ¢tÆVG2rÂFF¢6×æÖW3"æÖâÓâFFæ6×vç5¶åÒæÆVG2Â&6¶w&÷VæD6öÆ÷#¢w&v&bÃRÃ#ÃãrrÂ4C¢wrÒÂ²Æ&VÃ¢t5ÂrÂFF¢6×æÖW3"æÖâÓâFFæ6×vç5¶åÒæÆVG2âòFFæ6×vç5¶åÒç7VæBòFFæ6×vç5¶åÒæÆVG2¢Â&÷&FW$6öÆ÷#¢r6VcCCCBrÂGS¢vÆæRrÂ4C¢wrÂFVç6öã¢ã2ÕÒÂ²¢²÷6Föã¢w&vBrÒÂ¢²÷6Föã¢vÆVgBrÂw&C¢²G&töä6'D&V¢fÇ6RÒÒÒ¢Ð¢6öç7BvâÒö&¦V7Bæ¶W2FFævVæFW'2æfÇFW"rÓârÓÒwVæ¶æ÷vâr¢6öç7BväÆÂÒö&¦V7Bæ¶W2FFævVæFW'2¢bväÆÂæÆVæwFâ°¢6öç7BtÆ&VÇ2ÒväÆÂæÖrÓârÓÓÒvfVÖÆRrò}z
zyyÒr¢rÓÓÒvÖÆRrò}y-yzyyÒr¢}yÍy
yy=y]z"r¢7&VFT6'BvvVæFW%7VæD6'BrÂvF÷VvçWBrÂtÆ&VÇ2Â·²FF¢väÆÂæÖrÓâFFævVæFW'5¶uÒç7VæBÂ&6¶w&÷VæD6öÆ÷#¢²w&v&#3bÃs"ÃS2ÃãrrÂw&v&SÃ3Ã#CbÃãrrÂw&v&#CRÃSÃÃãruÒÂ&÷&FW$6öÆ÷#¢²r6ffbrÂr6ffbrÂr6ffbuÒÂ&÷&FW%vGF¢2ÕÒ¢7&VFT6'BvvVæFW$ÆVG46'BrÂvF÷VvçWBrÂtÆ&VÇ2Â·²FF¢väÆÂæÖrÓâFFævVæFW'5¶uÒæÆVG2Â&6¶w&÷VæD6öÆ÷#¢²w&v&#3bÃs"ÃS2ÃãrrÂw&v&SÃ3Ã#CbÃãrrÂw&v&#CRÃSÃÃãruÒÂ&÷&FW$6öÆ÷#¢²r6ffbrÂr6ffbrÂr6ffbuÒÂ&÷&FW%vGF¢2ÕÒ¢Ð¢6öç7BâÒö&¦V7Bæ¶W2FFævW2æfÇFW"ÓâÓÒwVæ¶æ÷vârç6÷'BÂ"Óâ'6TçBÇÂÒ'6TçB"ÇÂ¢bâæÆVæwFâ°¢7&VFT6'BvvU7VæDÆVG2rÂv&"rÂâÂ·²Æ&VÃ¢}yMy]zmy
yBrÂFF¢âæÖÓâFFævW5¶Òç7VæBÂ&6¶w&÷VæD6öÆ÷#¢w&v&SÃ3Ã#CbÃãRrÂ&÷&FW$6öÆ÷#¢r36#&cbrÂ&÷&FW%vGF¢"Â4C¢wrÒÂ²Æ&VÃ¢}yÍyy=yyÒrÂFF¢âæÖÓâFFævW5¶ÒæÆVG2Â&6¶w&÷VæD6öÆ÷#¢w&v&bÃRÃ#ÃãRrÂ&÷&FW$6öÆ÷#¢r3#rÂ&÷&FW%vGF¢"Â4C¢wrÕÒÂ²¢²÷6Föã¢w&vBrÂFFÆS¢²F7Æ¢G'VRÂFWC¢}yMy]zmy
yB(*¢rÒÒÂ¢²÷6Föã¢vÆVgBrÂFFÆS¢²F7Æ¢G'VRÂFWC¢}yÍyy=yyÒrÒÂw&C¢²G&töä6'D&V¢fÇ6RÒÒÒ¢6öç7BvT5ÆFFÒâæÖÓâFFævW5¶ÒæÆVG2âòFFævW5¶Òç7VæBòFFævW5¶ÒæÆVG2¢¢6öç7BvT5Æ6öÆ÷'2ÒvT5ÆFFæÖbÓâbÂòr3#r¢bÂ#òr36#&cbr¢bÂSòr3#V6cbr¢r6VcCCCBr¢6öç7BvT5Æ&rÒvT5ÆFFæÖbÓâbÂòw&v&bÃRÃ#ÃãRr¢bÂ#òw&v&SÃ3Ã#CbÃãRr¢bÂSòw&v&3Ã"Ã#CbÃãRr¢w&v&#3ÃcÃcÃãRr¢7&VFT6'BvvT5ÂrÂv&"rÂâÂ·²Æ&VÃ¢t5Â(*¢rÂFF¢vT5ÆFFÂ&6¶w&÷VæD6öÆ÷#¢vT5Æ&rÂ&÷&FW$6öÆ÷#¢vT5Æ6öÆ÷'2Â&÷&FW%vGF¢"ÕÒ¢7&VFT6'BvvU&FW2rÂv&"rÂâÂ·²Æ&VÃ¢t5E"RrÂFF¢âæÖÓâFFævW5¶Òæ×&W76öç2âòFFævW5¶Òæ6Æ6·2òFFævW5¶Òæ×&W76öç2¢¢Â&6¶w&÷VæD6öÆ÷#¢w&v&bÃ"Ã#"ÃãRrÂ&÷&FW$6öÆ÷#¢r3f#fCBrÂ&÷&FW%vGF¢"ÒÂ²Æ&VÃ¢}y
y}y]yb
yMyízyBRrÂFF¢âæÖÓâFFævW5¶Òæ6Æ6·2âòFFævW5¶ÒæÆVG2òFFævW5¶Òæ6Æ6·2¢¢Â&6¶w&÷VæD6öÆ÷#¢w&v&3Ã"Ã#CbÃãRrÂ&÷&FW$6öÆ÷#¢r3#V6cbrÂ&÷&FW%vGF¢"ÕÒ¢7&VFT6'BvvT5ÒrÂv&"rÂâÂ·²Æ&VÃ¢t5Ò(*¢rÂFF¢âæÖÓâFFævW5¶Òæ×&W76öç2âòFFævW5¶Òç7VæBòFFævW5¶Òæ×&W76öç2¢¢Â&6¶w&÷VæD6öÆ÷#¢w&v&#CRÃSÃÃãRrÂ&÷&FW$6öÆ÷#¢r6cSS"rÂ&÷&FW%vGF¢"ÕÒ¢Ð¢ÒÂ# ¢6öç7B6×æÖW2Òö&¦V7Bæ¶W2FFæ6×vç2¢6öç7BvVæFW$æÖW2Òö&¦V7Bæ¶W2FFævVæFW'2æfÇFW"rÓârÓÒwVæ¶æ÷vâr¢6öç7BvTæÖW2Òö&¦V7Bæ¶W2FFævW2æfÇFW"ÓâÓÒwVæ¶æ÷vâr ¢6öç7Bf%&W÷'G2Ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒvf6V&öö²r¢6öç7Bu&W÷'G2Ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6Rbb"ç6÷W&6Rç7F'G5vFvvöövÆRr¢6öç7B7&Õ&W÷'G2Ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒv7&Òr¢6öç7B7&Õ&W&W÷'G2Ò7W'&VçE&W÷'G2æfÇFW""Óâ"ç6÷W&6RÓÓÒv7&Õ÷&W÷'G2r¢6öç7B4f"Òf%&W÷'G2æÆVæwFâ ¢6öç7B5ÖÒu&W÷'G2ç6öÖR"Óâ"ç6÷W&6RÓÓÒvvöövÆU÷Ör¢6öç7B56V&6Òu&W÷'G2ç6öÖR"Óâ"ç6÷W&6RÓÓÒvvöövÆU÷6V&6r¢6öç7B4rÒu&W÷'G2æÆVæwFâ ¢6öç7B47&ÒÒ7&Õ&W÷'G2æÆVæwFâÇÂ7&Õ&W&W÷'G2æÆVæwFâ  ¢ÆWBf%F÷FÇ2ÒçVÆÂÂuF÷FÇ2ÒçVÆÀ¢b4f"²ÆWBf%&÷w2ÒµÓ²f%&W÷'G2æf÷$V6"Óâ²b"æFFf%&÷w2Òf%&÷w2æ6öæ6B"æFFÒ²f%F÷FÇ2Òvw&VvFU&÷w2f%&÷w2çF÷FÇ2Ð¢b4r²ÆWBu&÷w2ÒµÓ²u&W÷'G2æf÷$V6"Óâ²b"æFFu&÷w2Òu&÷w2æ6öæ6B"æFFÒ²uF÷FÇ2Òvw&VvFU&÷w2u&÷w2çF÷FÇ2Ð ¢6öç7B7FfUBÒF6F"ÓÓÒvf6V&öö²rbbf%F÷FÇ2òf%F÷FÇ2¢F6F"ÓÓÒvvöövÆRrbbuF÷FÇ2òuF÷FÇ2¢@¢6öç7B7FfUÒF6F"ÓÒvÆÂròçVÆÂ¢  ¢òòF÷FÂÆVG2æ6ÇVFær5$Òf÷"&ÆÂ"F"F7Æ¢6öç7BF÷FÄÆVG5vF7&ÒÒF6F"ÓÓÒvÆÂròBæÆVG2²7&ÕF÷FÄÆVG2¢7FfUBæÆVG0 ¢&WGW&â¢Ãà¢²ò¢6÷W&6RF'2¢÷Ð¢ÆFb6Æ74æÖSÒ&6ÆVçB×F'2#à¢Æ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶F6F"ÓÓÒvÆÂròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WDF6F"vÆÂrÓíyMy½yÃÂö'WGFöãà¢¶4f"bbÆ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶F6F"ÓÓÒvf6V&öö²ròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WDF6F"vf6V&öö²rÓäf6V&öö³Âö'WGFöãçÐ¢¶5ÖbbÆ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶F6F"ÓÓÒvvöövÆU÷Öròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WDF6F"vvöövÆU÷ÖrÓävöövÆRÖÂö'WGFöãçÐ¢¶56V&6bbÆ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶F6F"ÓÓÒvvöövÆU÷6V&6ròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WDF6F"vvöövÆU÷6V&6rÓävöövÆR6V&6Âö'WGFöãçÐ¢¶4rbbÆ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶F6F"ÓÓÒvvöövÆRròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WDF6F"vvöövÆRrÓävöövÆSÂö'WGFöãçÐ¢¶47&ÒbbÆ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶F6F"ÓÓÒv7&Òròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WDF6F"v7&ÒrÓä5$ÓÂö'WGFöãçÐ¢ÂöFcà ¢¶F6F"ÓÓÒv7&ÒròÃà¢ÆFb6Æ74æÖSÒ&6ÆVçB×F'2"7GÆS×·¶Ö&vä&÷GFöÓ¢W×Óà¢Æ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶7&Õ7V%F"ÓÓÒw6÷W&6W2ròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WD7&Õ7V%F"w6÷W&6W2rÓï	ù8"
yíz}y]zy]z¢
yMy-z-yCÂö'WGFöãà¢Æ'WGFöâ6Æ74æÖS×¶6ÆVçB×F"G¶7&Õ7V%F"ÓÓÒw&W÷'G2ròv7FfRr¢rwÖÒöä6Æ6³×²Óâ6WD7&Õ7V%F"w&W÷'G2rÓï	ù8¢
yíy}y]yÍyÂ
y=y]y}y]z£Âö'WGFöãà¢ÂöFcà¢¶7&Õ7V%F"ÓÓÒw6÷W&6W2rò&VæFW$7&ÔF6&ö&B¢&VæFW$7&Õ&W÷'DF6&ö&BÐ¢Âóâ¢Ãà¢ÆFb6Æ74æÖSÒ&·Öw&B#à¢¶·}z­z}zmyyrÂf÷&ÖD7W'&Væ77FfUBç7VæBÂrrÂ7FfUBç7VæBÂ7FfUòç7VæBÂG'VRÐ¢¶F6F"ÓÓÒvÆÂrò·}yÍyy=yyÒrÂf÷&ÖDçVÒF÷FÄÆVG5vF7&ÒÂvw&VVârÂF÷FÄÆVG5vF7&ÒÂ7FfUòæÆVG2¢·}yÍyy=yyÒrÂf÷&ÖDçVÒ7FfUBæÆVG2Âvw&VVârÂ7FfUBæÆVG2Â7FfUòæÆVG2Ð¢¶·}z-yÍy]z¢
yÍyÍyy2rÂf÷&ÖD7W'&Væ77FfUBæ7ÂÂwW'ÆRrÂ7FfUBæ7ÂÂ7FfUòæ7ÂÂG'VRÐ¢¶F6F"ÓÓÒvÆÂrbb7&ÕF÷FÇ2ò·}zMy-yzy]z¢
zz­y]y
yíyRrÂf÷&ÖDçVÒ7&ÕF÷FÇ2æÖVWFæw566VGVÆVBÇÂÂv7ârÂ7&ÕF÷FÇ2æÖVWFæw566VGVÆVBÂçVÆÂ¢çVÆÇÐ¢¶F6F"ÓÓÒvÆÂrbb7&ÕF÷FÇ2ò·}zMy-yzy]z¢
zyy]zmz-yRrÂf÷&ÖDçVÒ7&ÕF÷FÇ2æÖVWFæw46ö×ÆWFVBÇÂÂv÷&ævRrÂ7&ÕF÷FÇ2æÖVWFæw46ö×ÆWFVBÂçVÆÂ¢çVÆÇÐ¢¶F6F"ÓÓÒvÆÂrbb7&ÕF÷FÇ2ò·}yMzzyíy]z¢rÂf÷&ÖDçVÒ7&ÕF÷FÇ2ç&Vv7G&Föç2ÇÂÂvw&VVârÂ7&ÕF÷FÇ2ç&Vv7G&Föç2ÂçVÆÂ¢çVÆÇÐ¢¶F6F"ÓÓÒvÆÂrbb7&ÕF÷FÇ2ò·}y}y]ymyyÒrÂf÷&ÖDçVÒ7&ÕF÷FÇ2æ6öçG&7G2ÇÂÂwæ²rÂ7&ÕF÷FÇ2æ6öçG&7G2ÂçVÆÂ¢çVÆÇÐ¢ÂöFcà ¢²ò¢eTääTÂ¢÷Ð¢ÆFb6Æ74æÖSÒ'6V7Föâ#à¢ÆFb6Æ74æÖSÒ'6V7FöâÖVFW""7GÆS×·¶F7Æ¢vfÆWrÆÆväFV×3¢v6VçFW"rÆv¢s'rÆÖ&vä&÷GFöÓ¢s#w×Óà¢ÆFb6Æ74æÖSÒ'6V7FöâÖ6öâ"7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓ"w×Óï	ùKÓÂöFcà¢ÆFcãÆ"7GÆS×·¶föçE6¦S¢sã6VÒrÆföçEvVvC£sÆ6öÆ÷#¢wf"Ò×&Ö'rÆÖ&vã£×ÓíyízzMy¢
zyy]y]z}yÂö#ãÆFb7GÆS×·¶föçE6¦S¢sãVVÒrÆ6öÆ÷#¢wf"Ò×FWB×6V6öæF'w×Óíyíz}yÍyzr
y]z-y2
y}y]ymyCÂöFcãÂöFcà¢ÂöFcà¢ÆFb6Æ74æÖSÒ&6&B"7GÆS×··FFæs¢s#Gw×Óà¢ÆFb6Æ74æÖSÒ&gVææVÂ#à¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓw×Óç¶f÷&ÖDçVÒ7FfUBæ6Æ6·2ÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#íz}yÍyz}yyÓÂöFcãÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂÖ'&÷r#âfÆ'#³ÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖ66VçBrÆ÷6G£ãW×Óç¶f÷&ÖDçVÒ7FfUBæ×&W76öç2ÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#íy}zyzMy]z£ÂöFcãÂöFcà¢¶F6F"ÓÓÒvÆÂrbb7&ÕF÷FÇ2òÃãÆFb6Æ74æÖSÒ&gVææVÂÖ'&÷r#âfÆ'#³ÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖ7âw×Óç¶f÷&ÖDçVÒ7&ÕF÷FÇ2æÖVWFæw566VGVÆVBÇÂÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#ízMy-yzy]z¢
yíz­y]y
yíy]z£ÂöFcãÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂÖ'&÷r#âfÆ'#³ÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"×'WÆRw×Óç¶f÷&ÖDçVÒ7&ÕF÷FÇ2æÖVWFæw46ö×ÆWFVBÇÂÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#ízyzy]z¢
zyy]zmz-ySÂöFcãÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂÖ'&÷r#âfÆ'#³ÂöFcà¢ÆFb6Æ74æÖSÒ&gVææVÂ×7FW#ãÆFb6Æ74æÖSÒ&gVææVÂÖ&""7GÆS×·¶&6¶w&÷VæC¢wf"ÒÖw&FVçBÓ"w×Óç¶f÷&ÖDçVÒ7&ÕF÷FÇ2ç&Vv7G&Föç2ÇÂÓÂöFcãÆFb6Æ74æÖSÒ&gVææVÂÖÆ&VÂ#íyMzzyíy]z£ÂöFcãÂöFcà¢ÆFb6Æ
