const Post = require("../models/post.model");
const User = require("../models/user.model");
const ErrorHandler = require("../utils/errorHandler");
const cloudinary = require("cloudinary");

const createPost = async (req, res, next) => {
  try {
    const userId = req.userId;
    const data = req.body;
    const photo = data.photo;
    if (photo) {
      const myCloud = await cloudinary.v2.uploader.upload(photo, {
        folder: "post",
      });

      data.photo = {
        public_id: myCloud.public_id,
        url: myCloud.secure_url,
      };
    }

    const user = await User.findById(userId);

    data.author = user;
    const post = await Post.create(data);
    res.status(201).json({
      success: true,
      post,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const getAllPost = async (req, res, next) => {
  try {
    const { search, category, page } = req.query;

    const result = Post.find({
      $or: [
        {title: { $regex: search, $options: "i" }},
        {category: category},
      ]
    }).sort("-createdAt");

    const pageNo = Number(page) || 1;
    const limit = 3;
    const skip = (pageNo - 1) * limit;

    const posts = await result.limit(limit).skip(skip);
    const totalPost = await Post.countDocuments();
    let numOfPage;
    if (!search && !category) {
      numOfPage = Math.ceil(totalPost / limit);
    } else {
      numOfPage = Math.ceil(posts.length / limit);
    }

    res.status(201).json({
      success: true,
      posts,
      numOfPage,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const getPost = async (req, res, next) => {
  try {
    const id = req.params?.id;
    const post = await Post.findById(id);
    if (!post) {
      return next(new ErrorHandler("Post doesn't exist", 401));
    }

    res.status(200).json({
      success: true,
      post,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const getMyPost = async (req, res, next) => {
  try {
    const userId = req.userId;
    const posts = await Post.find({}).sort("-createdAt");
    const userPost = posts.filter((post) => post.author._id == userId);
    res.status(200).json({
      success: true,
      posts: userPost,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const deleteMyPost = async (req, res, next) => {
  try {
    const userId = req.userId;
    const id = req.params.id;
    const post = await Post.findById({
      _id: id,
    });

    const isMine = post?.author?._id == userId;
    if (!isMine) {
      return next(new ErrorHandler("Can't delete this post", 401));
    }
    if (!post) {
      return next(new ErrorHandler("Post does not exist", 401));
    }

    post.deleteOne();
    post.save();

    res.status(201).json({
      success: true,
      message: "Post deleted",
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const editMyPost = async (req, res, next) => {
  try {
    const userId = req.userId;
    const id = req.params.id;
    const data = req.body;

    const post = await Post.findById(id);

    const isMine = post.author._id == userId;
    if (!isMine) {
      return next(new ErrorHandler("you can't edit this post", 400));
    }
    const photo = data.photo;
    if (photo && !photo.startsWith("https")) {
      await cloudinary.v2.uploader.destroy(post.photo.public_id);
      const myCloud = await cloudinary.v2.uploader.upload(photo, {
        folder: "post",
      });

      data.photo = {
        public_id: myCloud.public_id,
        url: myCloud.secure_url,
      };
    }
    data.photo = {
      public_id: post?.photo?.public_id,
      url: post?.photo?.url,
    };
    const updatedPost = await Post.findByIdAndUpdate(
      id,
      {
        $set: data,
      },
      { new: true }
    );

    res.status(201).json({
      success: true,
      post: updatedPost,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const addCommentToPost = async (req, res, next) => {
  try {
    const { postId, comment } = req.body;
    const userId = req.userId;
    const post = await Post.findById(postId);
    const user = await User.findById(userId);
    console.log(userId);
    if (!user) {
      return next(new ErrorHandler("Please login to comment", 400));
    }
    const commentObj = {
      user,
      comment,
    };

    post.comments.push(commentObj);

    await post?.save();

    res.status(201).json({
      success: true,
      post,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const likePost = async (req, res, next) => {
  try {
    const userId = req.userId;
    const { postId } = req.body;
    const post = await Post.findById(postId);

    const index = post?.likes?.findIndex((id) => String(id) === userId);
    if (index === -1) {
      post.likes.push(userId);
    } else {
      post.likes = post?.likes?.filter((id) => String(id) !== userId);
    }

    await post.save();
    res.status(201).json({ success: true, post });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};

const getTrendingPost = async (req, res, next) => {
  try {
    const limit = 5; // Number of trending posts to return
    
    // Get posts from the last 30 days to consider for trending
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const posts = await Post.find({
      createdAt: { $gte: thirtyDaysAgo }
    })
    .populate('author', 'name photo')
    .lean();
    
    // Calculate trending score for each post
    const postsWithScore = posts.map(post => {
      const likesCount = post.likes?.length || 0;
      const commentsCount = post.comments?.length || 0;
      
      // Calculate days since creation
      const daysSinceCreation = Math.max(
        1, 
        (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Trending score formula:
      // (likes * 2 + comments * 3) / days^1.5
      // This gives more weight to recent posts with high engagement
      const trendingScore = (
        (likesCount * 2) + (commentsCount * 3)
      ) / Math.pow(daysSinceCreation, 1.5);
      
      return {
        ...post,
        trendingScore
      };
    });
    
    // Sort by trending score and get top posts
    const trendingPosts = postsWithScore
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, limit)
      .map(({ trendingScore, ...post }) => post); // Remove score from response
    
    res.status(200).json({
      success: true,
      posts: trendingPosts,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
};


module.exports = {
  createPost,
  getAllPost,
  getPost,
  getMyPost,
  deleteMyPost,
  addCommentToPost,
  editMyPost,
  likePost,
  getTrendingPost,
};
