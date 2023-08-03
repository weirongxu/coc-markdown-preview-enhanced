import { utility } from '@shd101wyy/mume'
import {
  Document,
  Position,
  Range,
  TextEdit,
  Uri,
  window,
  workspace,
} from 'coc.nvim'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from './util'

/**
 * Copy ans paste image at imageFilePath to config.imageForlderPath.
 * Then insert markdown image url to markdown file.
 * @param uri
 * @param imageFilePath
 */
export async function pasteImageFile(
  sourceUri: Uri | string,
  imageFilePath: string,
) {
  const finalSourceUri =
    typeof sourceUri === 'string' ? Uri.parse(sourceUri) : sourceUri

  const imageFolderPath = workspace
    .getConfiguration('markdown-preview-enhanced')
    .get<string>('imageFolderPath')!
  let imageFileName = path.basename(imageFilePath)
  const projectDirectoryPath = workspace.root
  let assetDirectoryPath: string
  let description: string
  if (imageFolderPath[0] === '/') {
    assetDirectoryPath = path.resolve(
      projectDirectoryPath,
      `.${imageFolderPath}`,
    )
  } else {
    assetDirectoryPath = path.resolve(
      path.dirname(finalSourceUri.fsPath),
      imageFolderPath,
    )
  }

  const destPath = path.resolve(
    assetDirectoryPath,
    path.basename(imageFilePath),
  )

  const doc = await workspace.document
  const pos = await window.getCursorPosition()
  fs.mkdir(assetDirectoryPath, () => {
    fs.stat(destPath, (err) => {
      if (err == null) {
        // file existed
        const lastDotOffset = imageFileName.lastIndexOf('.')
        const uid = `_${Math.random().toString(36).substring(2, 10)}`

        if (lastDotOffset > 0) {
          description = imageFileName.slice(0, lastDotOffset)
          imageFileName =
            imageFileName.slice(0, lastDotOffset) +
            uid +
            imageFileName.slice(lastDotOffset, imageFileName.length)
        } else {
          description = imageFileName
          imageFileName = imageFileName + uid
        }

        fs.createReadStream(imageFilePath).pipe(
          fs.createWriteStream(path.resolve(assetDirectoryPath, imageFileName)),
        )
      } else if (err.code === 'ENOENT') {
        // file doesn't exist
        fs.createReadStream(imageFilePath).pipe(fs.createWriteStream(destPath))

        if (imageFileName.lastIndexOf('.')) {
          description = imageFileName.slice(0, imageFileName.lastIndexOf('.'))
        } else {
          description = imageFileName
        }
      } else {
        window.showErrorMessage(err.message.toString()).catch(logger.error)
      }

      void window.showInformationMessage(
        `Image ${imageFileName} has been copied to folder ${assetDirectoryPath}`,
      )

      let url = `${imageFolderPath}/${imageFileName}`
      if (url.indexOf(' ') >= 0) {
        url = url.replace(/ /g, '%20')
      }

      doc
        .applyEdits([TextEdit.insert(pos, `![${description}](${url})`)])
        .catch(logger.error)
    })
  })
}

function replaceHint(
  doc: Document,
  line: number,
  hint: string,
  withStr: string,
): boolean {
  const textLine = doc.getline(line)
  if (textLine.indexOf(hint) >= 0) {
    doc
      .applyEdits([
        TextEdit.replace(
          Range.create(
            Position.create(line, 0),
            Position.create(line, textLine.length),
          ),
          textLine.replace(hint, withStr),
        ),
      ])
      .catch(logger.error)
    return true
  }
  return false
}

function setUploadedImageURL(
  imageFileName: string,
  url: string,
  doc: Document,
  hint: string,
  curPos: Position,
) {
  let description: string
  if (imageFileName.lastIndexOf('.')) {
    description = imageFileName.slice(0, imageFileName.lastIndexOf('.'))
  } else {
    description = imageFileName
  }

  const withStr = `![${description}](${url})`

  if (!replaceHint(doc, curPos.line, hint, withStr)) {
    let i = curPos.line - 20
    while (i <= curPos.line + 20) {
      if (replaceHint(doc, i, hint, withStr)) {
        break
      }
      i++
    }
  }
}

/**
 * Upload image at imageFilePath to config.imageUploader.
 * Then insert markdown image url to markdown file.
 * @param uri
 * @param imageFilePath
 */
export async function uploadImageFile(
  sourceUri: unknown,
  imageFilePath: string,
  imageUploader: string,
) {
  // console.log('uploadImageFile', sourceUri, imageFilePath, imageUploader)
  if (typeof sourceUri === 'string') {
    sourceUri = Uri.parse(sourceUri)
  }
  const imageFileName = path.basename(imageFilePath)

  const doc = await workspace.document
  const uid = Math.random().toString(36).substring(2, 10)
  const hint = `![Uploading ${imageFileName}… (${uid})]()`
  const curPos = await window.getCursorPosition()

  await doc.applyEdits([TextEdit.insert(curPos, hint)])

  const config = workspace.getConfiguration('markdown-preview-enhanced')
  const AccessKey = config.get<string>('AccessKey') || ''
  const SecretKey = config.get<string>('SecretKey') || ''
  const Bucket = config.get<string>('Bucket') || ''
  const Domain = config.get<string>('Domain') || ''

  utility
    .uploadImage(imageFilePath, {
      method: imageUploader,
      qiniu: { AccessKey, SecretKey, Bucket, Domain },
    })
    .then((url) => {
      setUploadedImageURL(imageFileName, url, doc, hint, curPos)
    })
    .catch(logger.error)
}
