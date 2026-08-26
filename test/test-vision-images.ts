import fs from 'fs'
import path from 'path'
import { parseVisionFromImage, ParsedCourseTableFromVision } from '../src/vision'

async function testImages() {
  const dir = 'D:/harmony/helper_app/temp/course_picture'
  const files = fs.readdirSync(dir)
  for (const f of files) {
    if (!f.endsWith('.png') && !f.endsWith('.jpg') && !f.endsWith('.jpeg')) continue
    const fullPath = path.join(dir, f)
    console.log(`\n========================================`)
    console.log(`Testing image: ${f} (${fs.statSync(fullPath).size} bytes)`)
    const base64 = fs.readFileSync(fullPath).toString('base64')
    try {
      const result = (await parseVisionFromImage(base64, 'course_table')) as ParsedCourseTableFromVision
      console.log(`Parsed courses count: ${result.courses?.length || 0}`)
      if (result.courses && result.courses.length > 0) {
        console.log(`Sample course:`, result.courses[0])
      }
      console.log(`Semester: ${result.semester}`)
      console.log(`Confidence: ${result.confidence}`)
    } catch (e) {
      console.error(`Error parsing ${f}:`, e)
    }
  }
}

testImages()
