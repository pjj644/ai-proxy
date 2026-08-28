async function verifyAll() {
  console.log('========================================================================')
  console.log('🔍 华为 AGC 平台数据获取与 image/image.png 逐项精细化核对报告')
  console.log('========================================================================\n')

  // 1. 查询课程
  const courseRes = await fetch('http://localhost:3000/api/v1/agc/query-courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'student_demo_id', semesterId: 523 })
  })
  const courseData = await courseRes.json()

  // 2. 查询考试
  const examRes = await fetch('http://localhost:3000/api/v1/agc/query-exams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'student_demo_id', semesterId: 523 })
  })
  const examData = await examRes.json()

  console.log(`[AGC 数据拉取结果] 课程记录: ${courseData.count} 门, 考试排期: ${examData.count} 门`)
  console.log(`[数据源] 学期 ID: 523 (2026-2027学年 第一学期)\n`)

  console.log('========================================================================')
  console.log('📋 课程明细与 temp/image/image.png 逐格对应核对:')
  console.log('========================================================================')
  const dayNames = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']
  
  courseData.data.forEach((c, idx) => {
    console.log(`${idx + 1}. 【${dayNames[c.dayOfWeek]} 第 ${c.startSection}-${c.startSection + c.duration - 1} 节】`)
    console.log(`   - 课程名称: ${c.courseName}`)
    console.log(`   - 课程代码: ${c.courseId}`)
    console.log(`   - 任课教师: ${c.teacherName}`)
    console.log(`   - 上课教室: ${c.roomName}`)
    console.log(`   - 行课周次: ${c.validWeeks}`)
    console.log(`   - 周次展开: [${c.stepWeeks.join(', ')}]`)
    console.log('')
  })

  console.log('========================================================================')
  console.log('📋 考试排期明细表 (ClassExam):')
  console.log('========================================================================')
  examData.data.forEach((e, idx) => {
    console.log(`${idx + 1}. 【${e.examDate} ${e.examTimeRange}】 ${e.courseName}`)
    console.log(`   - 考试代码: ${e.courseNo}`)
    console.log(`   - 考场地点: ${e.examLocation}`)
    console.log(`   - 座位编号: ${e.seatNo}`)
    console.log(`   - 考试类别: ${e.examType}`)
    console.log(`   - 当前状态: ${e.examStatus}`)
    console.log('')
  })
}

verifyAll().catch(console.error)
