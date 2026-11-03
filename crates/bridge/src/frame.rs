//! Length-prefixed frames: a 32-bit length in native byte order, then that many bytes.
//!
//! Chrome uses this framing on the native host's stdin and stdout; the bridge reuses it on the
//! local socket. The length is checked before the body is read or allocated.

use std::io;

use islet_protocol::MAX_MESSAGE_BYTES;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// One frame read from a stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Message(Vec<u8>),
    /// The length prefix was over [`MAX_MESSAGE_BYTES`]. The body was skipped through a small
    /// fixed buffer, never stored, so the stream is still in sync.
    TooLarge {
        len: usize,
    },
}

/// Reads the next frame. `Ok(None)` means the stream ended cleanly between frames; a stream that
/// ends inside a frame is an [`io::ErrorKind::UnexpectedEof`] error.
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<Option<Frame>> {
    let mut prefix = [0u8; 4];
    if reader.read(&mut prefix[..1]).await? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut prefix[1..]).await?;
    let len = u32::from_ne_bytes(prefix);
    let len = usize::try_from(len).unwrap_or(usize::MAX);

    if len > MAX_MESSAGE_BYTES {
        let wanted = u64::try_from(len).unwrap_or(u64::MAX);
        let skipped =
            tokio::io::copy(&mut (&mut *reader).take(wanted), &mut tokio::io::sink()).await?;
        if skipped < wanted {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        return Ok(Some(Frame::TooLarge { len }));
    }

    let mut body = vec![0; len];
    reader.read_exact(&mut body).await?;
    Ok(Some(Frame::Message(body)))
}

/// Writes one frame and flushes it. Bodies over [`MAX_MESSAGE_BYTES`] are refused.
pub async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, body: &[u8]) -> io::Result<()> {
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "frame over the message size limit",
        ));
    }
    let len = u32::try_from(body.len()).map_err(|_| io::ErrorKind::InvalidInput)?;
    writer.write_all(&len.to_ne_bytes()).await?;
    writer.write_all(body).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn framed(body: &[u8]) -> Vec<u8> {
        let mut out = u32::try_from(body.len()).unwrap().to_ne_bytes().to_vec();
        out.extend_from_slice(body);
        out
    }

    #[tokio::test]
    async fn round_trips_and_ends_cleanly() {
        let mut stream = Vec::new();
        write_frame(&mut stream, b"{\"a\":1}").await.unwrap();
        write_frame(&mut stream, b"").await.unwrap();
        let mut reader = stream.as_slice();
        assert_eq!(
            read_frame(&mut reader).await.unwrap(),
            Some(Frame::Message(b"{\"a\":1}".to_vec()))
        );
        assert_eq!(
            read_frame(&mut reader).await.unwrap(),
            Some(Frame::Message(Vec::new()))
        );
        assert_eq!(read_frame(&mut reader).await.unwrap(), None);
    }

    #[tokio::test]
    async fn truncated_frames_are_errors() {
        let mut short_prefix: &[u8] = &[1, 0];
        let error = read_frame(&mut short_prefix).await.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);

        let mut whole = framed(b"hello");
        whole.truncate(6);
        let error = read_frame(&mut whole.as_slice()).await.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[tokio::test]
    async fn skips_oversized_frames_and_stays_in_sync() {
        let mut stream = framed(&vec![b' '; MAX_MESSAGE_BYTES + 1]);
        stream.extend(framed(b"next"));
        let mut reader = stream.as_slice();
        assert_eq!(
            read_frame(&mut reader).await.unwrap(),
            Some(Frame::TooLarge {
                len: MAX_MESSAGE_BYTES + 1
            })
        );
        assert_eq!(
            read_frame(&mut reader).await.unwrap(),
            Some(Frame::Message(b"next".to_vec()))
        );
    }

    #[tokio::test]
    async fn a_huge_length_prefix_allocates_nothing() {
        // A 4 GiB prefix followed by a few bytes: allocating the body first would abort.
        let mut stream = u32::MAX.to_ne_bytes().to_vec();
        stream.extend_from_slice(b"tiny");
        let error = read_frame(&mut stream.as_slice()).await.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[tokio::test]
    async fn the_limit_is_inclusive() {
        let body = vec![b' '; MAX_MESSAGE_BYTES];
        let mut stream = Vec::new();
        write_frame(&mut stream, &body).await.unwrap();
        assert_eq!(
            read_frame(&mut stream.as_slice()).await.unwrap(),
            Some(Frame::Message(body))
        );

        let error = write_frame(&mut Vec::new(), &vec![b' '; MAX_MESSAGE_BYTES + 1])
            .await
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }
}
