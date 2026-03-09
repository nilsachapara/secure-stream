package main

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"strings"

	"github.com/gotd/td/tg"
)

// Bot API file type constants
const (
	fileTypeThumbnail   = 0
	fileTypeProfilePhoto = 1
	fileTypePhoto        = 2
	fileTypeVoice        = 3
	fileTypeVideo        = 4
	fileTypeDocument     = 5
	fileTypeEncrypted    = 6
	fileTypeTemp         = 7
	fileTypeSticker      = 8
	fileTypeAudio        = 9
	fileTypeAnimation    = 10
	fileTypeVideoNote    = 13
)

// rleDecompress decompresses the RLE encoding used by Telegram Bot API file_ids.
// The encoding: 0x00 byte followed by count byte = count zero bytes.
func rleDecompress(data []byte) []byte {
	var result []byte
	for i := 0; i < len(data); i++ {
		if data[i] == 0x00 {
			if i+1 < len(data) {
				i++
				for j := 0; j < int(data[i]); j++ {
					result = append(result, 0x00)
				}
			}
		} else {
			result = append(result, data[i])
		}
	}
	return result
}

// decodeFileID decodes a Bot API file_id into an MTProto InputFileLocation.
// The file_id is base64url encoded, then RLE compressed, containing:
// - type_id (4 bytes LE)
// - dc_id (4 bytes LE)
// - For documents: file_reference, id (8 bytes LE), access_hash (8 bytes LE)
func decodeFileID(fileID string) (tg.InputFileLocationClass, error) {
	// Fix base64url padding
	fileID = strings.TrimRight(fileID, "=")
	// Replace URL-safe chars
	fileID = strings.ReplaceAll(fileID, "-", "+")
	fileID = strings.ReplaceAll(fileID, "_", "/")
	// Add padding
	switch len(fileID) % 4 {
	case 2:
		fileID += "=="
	case 3:
		fileID += "="
	}

	decoded, err := base64.StdEncoding.DecodeString(fileID)
	if err != nil {
		return nil, fmt.Errorf("base64 decode failed: %w", err)
	}

	// RLE decompress
	data := rleDecompress(decoded)

	if len(data) < 8 {
		return nil, fmt.Errorf("file_id too short: %d bytes", len(data))
	}

	// First 4 bytes: type_id (with sub-version in high bits)
	typeRaw := binary.LittleEndian.Uint32(data[0:4])
	fileType := int(typeRaw & 0xFF)
	// Next 4 bytes: dc_id
	// dcID := binary.LittleEndian.Uint32(data[4:8])

	// For document-like types, the structure after dc_id is:
	// - file_reference_length (1 byte) [in newer versions]
	// - file_reference (variable)
	// - id (8 bytes LE)
	// - access_hash (8 bytes LE)
	//
	// However, the exact format varies. A more robust approach:
	// The last 16 bytes before any trailing data are always id (8) + access_hash (8)

	switch fileType {
	case fileTypeDocument, fileTypeVideo, fileTypeAudio, fileTypeVoice,
		fileTypeSticker, fileTypeAnimation, fileTypeVideoNote:
		return decodeDocumentFileID(data)
	case fileTypePhoto, fileTypeProfilePhoto, fileTypeThumbnail:
		return decodePhotoFileID(data)
	default:
		return decodeDocumentFileID(data) // try document format as fallback
	}
}

func decodeDocumentFileID(data []byte) (tg.InputFileLocationClass, error) {
	// For documents, the format is:
	// [0:4]   type_id
	// [4:8]   dc_id
	// [8:]    file_reference_flag (1 byte) + file_reference + id (8) + access_hash (8)
	//
	// The id and access_hash are always the last 16 bytes of the meaningful data

	if len(data) < 24 {
		return nil, fmt.Errorf("document file_id too short: %d bytes", len(data))
	}

	// The last 16 bytes are access_hash (8) + id is before that
	// Actually in Telegram's format: after header, we have
	// file_reference then id then access_hash
	// Let's read from the end

	// Strip trailing byte (version/sub-version marker in newer file_ids)
	// Try to find id and access_hash
	// They're 8 bytes each at specific positions

	offset := 8 // skip type_id + dc_id

	// Check if there's a file_reference
	// In newer file_ids (v4+), byte at offset is file_reference flag
	// If the remaining data is exactly 16 bytes, no file_reference
	remaining := data[offset:]

	var id int64
	var accessHash int64
	var fileReference []byte

	if len(remaining) == 16 {
		// No file reference: just id + access_hash
		id = int64(binary.LittleEndian.Uint64(remaining[0:8]))
		accessHash = int64(binary.LittleEndian.Uint64(remaining[8:16]))
	} else if len(remaining) > 16 {
		// Has file reference or extra data
		// The file reference is variable length, id+access_hash are at the end
		// But we need to handle the format carefully

		// Try: assume last 16 bytes are id + access_hash
		tailStart := len(remaining) - 16
		id = int64(binary.LittleEndian.Uint64(remaining[tailStart : tailStart+8]))
		accessHash = int64(binary.LittleEndian.Uint64(remaining[tailStart+8 : tailStart+16]))

		// Everything between offset and tail is file_reference (possibly with length prefix)
		if tailStart > 0 {
			fileReference = remaining[:tailStart]
			// Strip the length prefix byte if present
			if len(fileReference) > 0 && int(fileReference[0]) == len(fileReference)-1 {
				fileReference = fileReference[1:]
			}
		}
	} else {
		return nil, fmt.Errorf("unexpected data length: %d", len(remaining))
	}

	return &tg.InputDocumentFileLocation{
		ID:            id,
		AccessHash:    accessHash,
		FileReference: fileReference,
	}, nil
}

func decodePhotoFileID(data []byte) (tg.InputFileLocationClass, error) {
	// Photos have: type_id(4) + dc_id(4) + id(8) + access_hash(8) + volume_id(8) + local_id(4) + ...
	if len(data) < 24 {
		return nil, fmt.Errorf("photo file_id too short: %d bytes", len(data))
	}

	// For photos, try the same approach: id + access_hash from the structure
	remaining := data[8:]

	if len(remaining) < 16 {
		return nil, fmt.Errorf("photo data too short")
	}

	// For photos, the structure is different - id and access_hash first, then source info
	id := int64(binary.LittleEndian.Uint64(remaining[0:8]))
	accessHash := int64(binary.LittleEndian.Uint64(remaining[8:16]))

	var fileReference []byte
	// Check if there's more data that could be file_reference
	if len(remaining) > 16 {
		// Additional data exists, might contain file_reference and photo source
		fileReference = nil // Photo sources are complex, skip file_reference for now
	}

	return &tg.InputPhotoFileLocation{
		ID:            id,
		AccessHash:    accessHash,
		FileReference: fileReference,
	}, nil
}
