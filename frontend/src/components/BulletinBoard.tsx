import React, { useState } from "react";
import Markdown from "react-markdown";
import type { BulletinPost } from "../types";
import { AGENT_COLORS } from "../utils/sprites";

interface BulletinBoardProps {
  posts: BulletinPost[];
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function PostCard({ post }: { post: BulletinPost }) {
  const [expanded, setExpanded] = useState(false);
  const color = AGENT_COLORS[post.agent] ?? "#999";
  const isLong = post.content.length > 150;

  return (
    <div className="mx-3 my-2 rounded-lg bg-white border border-gray-200 shadow-sm overflow-hidden animate-fade-in hover:shadow transition-all">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-bold" style={{ color }}>
          {post.agent}
        </span>
        <span className="text-gray-400 text-[10px] ml-auto">
          {formatTime(post.timestamp)}
        </span>
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        {isLong && !expanded ? (
          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
            {post.content.slice(0, 150)}...
          </p>
        ) : (
          <div className="text-xs text-gray-700 leading-relaxed
            [&_p]:mb-1.5 [&_strong]:font-semibold [&_strong]:text-gray-800
            [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:pl-4 [&_ol]:list-decimal
            [&_li]:mb-0.5 [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mb-1
            [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mb-1
            [&_a]:text-blue-600 [&_a]:underline
          ">
            <Markdown>{post.content}</Markdown>
          </div>
        )}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-blue-500 hover:text-blue-700 mt-1 transition-colors"
          >
            {expanded ? "Show less" : "Read more"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function BulletinBoard({ posts }: BulletinBoardProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 font-medium">
            Pinned Findings
          </span>
          <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
            {posts.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {posts.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            <div className="text-center">
              <p className="text-lg mb-2 opacity-30">No findings yet</p>
              <p>Agents will post findings here</p>
            </div>
          </div>
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>
    </div>
  );
}
